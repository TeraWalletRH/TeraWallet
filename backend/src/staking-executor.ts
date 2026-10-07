import { decodeEventLog, encodeFunctionData, erc20Abi, getAddress, http, createPublicClient, keccak256, parseAbiItem, parseTransaction, TransactionNotFoundError, TransactionReceiptNotFoundError, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PoolClient } from "pg";
import pool from "./db";
import { env } from "./env";

const client = createPublicClient({ transport: http(env.rhcRpcUrl, { timeout: 10_000, retryCount: 1 }) });
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
let running = false;

type Payout = {
  id: string; wallet_address: string; principal_amount: string; reward_amount: string;
  status: "requested" | "signed" | "broadcast" | "confirmed" | "failed";
  serialized_tx: Hex | null; tx_hash: Hex | null;
};

function ready() {
  return Boolean(pool && env.teraStakingEnabled && /^0x[\da-fA-F]{64}$/.test(env.teraStakingPoolPrivateKey) && /^0x[\da-fA-F]{40}$/.test(env.teraTokenAddress));
}
function account() { return privateKeyToAccount(env.teraStakingPoolPrivateKey as Hex); }
function isAlreadyKnown(error: unknown) {
  return /already known|known transaction|already imported|nonce too low/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * The nonce for a new payout: past both the node's pending count and every payout
 * already signed or sent but not yet mined.
 *
 * Reading only the node's pending count let two payouts signed moments apart take
 * the same nonce when the node had not yet seen the first. Only one of them can be
 * mined; the other was then stuck as "broadcast" forever.
 */
export function nextNonce(pendingCount: number, outstanding: number[]) {
  return outstanding.reduce((next, nonce) => Math.max(next, nonce + 1), pendingCount);
}

/**
 * What to do about a sent payout whose transaction has no receipt.
 *
 *   wait        the node still knows the transaction; it may yet be mined.
 *   rebroadcast the node has dropped it and its nonce is still free: send the same
 *               bytes again. Nothing is signed twice.
 *   resign      its nonce has been used by another transaction, so these bytes can
 *               never be mined and nothing was paid. Sign it again with a fresh nonce.
 */
export function recoveryFor({ txKnown, latestNonce, txNonce }: { txKnown: boolean; latestNonce: number; txNonce: number }) {
  if (txKnown) return "wait" as const;
  return latestNonce > txNonce ? ("resign" as const) : ("rebroadcast" as const);
}

const nonceOf = (raw: Hex) => {
  const nonce = parseTransaction(raw).nonce;
  return typeof nonce === "number" ? nonce : null;
};

/** Persist signed transaction bytes before sending them. Safe to call repeatedly. */
export async function signPayout(payoutId: string): Promise<Payout> {
  if (!pool || !ready()) throw new Error("Staking payout executor is unavailable.");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const found = await db.query("SELECT id,wallet_address,principal_amount,reward_amount,status,serialized_tx,tx_hash FROM staking_payouts WHERE id=$1 FOR UPDATE", [payoutId]);
    const payout = found.rows[0] as Payout | undefined;
    if (!payout) throw new Error("Payout not found.");
    if (payout.status === "confirmed" || payout.status === "broadcast") { await db.query("COMMIT"); return payout; }
    if (payout.status === "signed" && payout.serialized_tx) { await db.query("COMMIT"); return payout; }
    if (payout.status !== "requested" && payout.status !== "failed") throw new Error("Payout cannot be signed in its current state.");
    const signer = account();
    const total = BigInt(payout.principal_amount) + BigInt(payout.reward_amount);
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(payout.wallet_address), total] });
    const [pending, gasPrice, outstanding] = await Promise.all([
      client.getTransactionCount({ address: signer.address, blockTag: "pending" }),
      client.getGasPrice(),
      db.query("SELECT serialized_tx FROM staking_payouts WHERE status IN ('signed','broadcast') AND serialized_tx IS NOT NULL AND id<>$1", [payout.id]),
    ]);
    const nonce = nextNonce(
      pending,
      outstanding.rows.map((row) => nonceOf(row.serialized_tx as Hex)).filter((n): n is number => n !== null),
    );
    const raw = await signer.signTransaction({ to: getAddress(env.teraTokenAddress), data, nonce, gas: 100000n, gasPrice, chainId: env.rhcChainId });
    const updated = await db.query("UPDATE staking_payouts SET status='signed',serialized_tx=$2,tx_hash=$3,updated_at=NOW(),failure_reason=NULL WHERE id=$1 RETURNING id,wallet_address,principal_amount,reward_amount,status,serialized_tx,tx_hash", [payout.id, raw, keccak256(raw)]);
    await db.query("COMMIT");
    return updated.rows[0] as Payout;
  } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
  finally { db.release(); }
}

/** Broadcast the persisted bytes. Repeating this call never creates a second signature. */
export async function broadcastPayout(payoutId: string): Promise<Payout> {
  if (!pool || !ready()) throw new Error("Staking payout executor is unavailable.");
  let payout = await signPayout(payoutId);
  if (payout.status === "broadcast" || payout.status === "confirmed") return payout;
  if (!payout.serialized_tx) throw new Error("Payout has no serialized transaction.");
  let txHash = payout.tx_hash!;
  try { txHash = await client.sendRawTransaction({ serializedTransaction: payout.serialized_tx }); }
  catch (error) { if (!isAlreadyKnown(error)) throw error; }
  const result = await pool.query("UPDATE staking_payouts SET status='broadcast',tx_hash=$2,updated_at=NOW() WHERE id=$1 AND status='signed' RETURNING id,wallet_address,principal_amount,reward_amount,status,serialized_tx,tx_hash", [payout.id, txHash]);
  return (result.rows[0] ?? { ...payout, status: "broadcast", tx_hash: txHash }) as Payout;
}

/** Confirm only a successful, exact TERA transfer after the configured confirmations. */
export async function confirmPayout(payoutId: string): Promise<Payout | null> {
  if (!pool || !ready()) throw new Error("Staking payout executor is unavailable.");
  const found = await pool.query("SELECT id,wallet_address,principal_amount,reward_amount,status,serialized_tx,tx_hash FROM staking_payouts WHERE id=$1", [payoutId]);
  const payout = found.rows[0] as Payout | undefined;
  if (!payout) throw new Error("Payout not found.");
  if (payout.status === "confirmed") return payout;
  if (payout.status !== "broadcast" || !payout.tx_hash) return null;
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: payout.tx_hash }); }
  catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) await recoverUnmined(payout);
    return null;
  }
  if (receipt.status !== "success") {
    await pool.query("UPDATE staking_payouts SET status='failed',failure_reason='Payout transaction reverted on chain.',updated_at=NOW() WHERE id=$1 AND status='broadcast'", [payout.id]);
    return null;
  }
  const head = await client.getBlockNumber();
  if (head - receipt.blockNumber + 1n < BigInt(env.teraStakingConfirmations)) return null;
  const sender = account().address, token = getAddress(env.teraTokenAddress), expected = BigInt(payout.principal_amount) + BigInt(payout.reward_amount);
  const matching = receipt.logs.filter((log) => {
    if (getAddress(log.address) !== token) return false;
    try { const decoded = decodeEventLog({ abi: [transferEvent], data: log.data, topics: log.topics }); const a = decoded.args as { from: Address; to: Address; value: bigint }; return getAddress(a.from) === sender && getAddress(a.to) === getAddress(payout.wallet_address) && a.value === expected; }
    catch { return false; }
  });
  if (matching.length !== 1) throw new Error("Payout receipt did not contain the expected TERA transfer.");
  const result = await pool.query("UPDATE staking_payouts SET status='confirmed',confirmed_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='broadcast' RETURNING id,wallet_address,principal_amount,reward_amount,status,serialized_tx,tx_hash", [payout.id]);
  if (result.rowCount) await pool.query("INSERT INTO staking_events (epoch_id,lock_id,wallet_address,kind,amount,metadata) SELECT epoch_id,lock_id,wallet_address,'payout_confirmed',principal_amount+reward_amount,jsonb_build_object('payoutId',id,'txHash',tx_hash) FROM staking_payouts WHERE id=$1", [payout.id]);
  return (result.rows[0] ?? payout) as Payout;
}

/**
 * A sent payout with no receipt: keep waiting, send the same bytes again, or — when
 * another transaction has taken its nonce, so it can never be mined and nothing was
 * paid — mark it failed and sign it again with a fresh nonce.
 */
async function recoverUnmined(payout: Payout) {
  if (!pool || !payout.serialized_tx || !payout.tx_hash) return;
  const txNonce = nonceOf(payout.serialized_tx);
  if (txNonce === null) return;
  let txKnown = true;
  try { await client.getTransaction({ hash: payout.tx_hash }); }
  catch (error) { txKnown = !(error instanceof TransactionNotFoundError); }
  const latestNonce = await client.getTransactionCount({ address: account().address, blockTag: "latest" });
  const action = recoveryFor({ txKnown, latestNonce, txNonce });
  if (action === "rebroadcast") {
    await client.sendRawTransaction({ serializedTransaction: payout.serialized_tx }).catch(() => {});
    return;
  }
  if (action !== "resign") return;
  // Re-signing pays again, so it waits out any node lag: the payout must have gone
  // unmined for ten minutes, and a last receipt check must still find nothing.
  const receipt = await client.getTransactionReceipt({ hash: payout.tx_hash }).catch(() => null);
  if (receipt) return;
  const marked = await pool.query(
    "UPDATE staking_payouts SET status='failed',failure_reason='Its nonce was used by another transaction before it was mined; nothing was paid. Re-sent with a new nonce.',updated_at=NOW() WHERE id=$1 AND status='broadcast' AND tx_hash=$2 AND updated_at < NOW() - INTERVAL '10 minutes'",
    [payout.id, payout.tx_hash],
  );
  if (marked.rowCount) await broadcastPayout(payout.id);
}

/** Processes one payout at a time under a database-wide advisory lock. */
export async function runStakingPayoutExecutor() {
  if (running || !pool || !ready()) return;
  running = true;
  let db: PoolClient | undefined;
  try {
    db = await pool.connect();
    const lock = await db.query("SELECT pg_try_advisory_lock(hashtext('tera_staking_payout_executor')) AS locked");
    if (!lock.rows[0]?.locked) return;
    try {
      const rows = await db.query("SELECT id,status FROM staking_payouts WHERE status IN ('broadcast','signed','requested') ORDER BY created_at ASC LIMIT 12");
      for (const payout of rows.rows) {
        try {
          if (payout.status === "broadcast") await confirmPayout(payout.id);
          else await broadcastPayout(payout.id);
        } catch (error) { console.error("Staking payout executor failed for", payout.id, error instanceof Error ? error.message : error); }
      }
    } finally { await db.query("SELECT pg_advisory_unlock(hashtext('tera_staking_payout_executor'))"); }
  } catch (error) {
    console.error("Staking payout executor cycle failed", error instanceof Error ? error.message : error);
  } finally { db?.release(); running = false; }
}

export function startStakingPayoutExecutor() {
  if (!ready()) return;
  void runStakingPayoutExecutor();
  setInterval(() => void runStakingPayoutExecutor(), 15_000).unref();
}
