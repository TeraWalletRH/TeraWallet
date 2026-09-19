import { decodeEventLog, encodeFunctionData, erc20Abi, getAddress, http, createPublicClient, keccak256, parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
    const [nonce, gasPrice] = await Promise.all([client.getTransactionCount({ address: signer.address, blockTag: "pending" }), client.getGasPrice()]);
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
  catch { return null; }
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

/** Processes one payout at a time under a database-wide advisory lock. */
export async function runStakingPayoutExecutor() {
  if (running || !pool || !ready()) return;
  running = true;
  const db = await pool.connect();
  try {
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
  } finally { db.release(); running = false; }
}

export function startStakingPayoutExecutor() {
  if (!ready()) return;
  void runStakingPayoutExecutor();
  setInterval(() => void runStakingPayoutExecutor(), 15_000).unref();
}
