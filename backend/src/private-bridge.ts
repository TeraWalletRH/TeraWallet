import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import pool from "./db";
import { env } from "./env";
import { DEPOSITORY, NATIVE, relay } from "./bridge";

export type PrivateBridgeJob = {
  id: string;
  asset_symbol: string;
  decimals: number;
  sender_address: string;
  destination_chain_id: number;
  destination_symbol: string;
  destination_currency: string;
  recipient_address: string;
  amount: string;
  expected_amount_out: string | null;
  min_amount_out: string | null;
  vault_address: string;
  payout_address: string;
  relay_request_id: string | null;
  status: string;
  expires_at: string;
  deposit_tx_hash: Hex | null;
  sweep_tx_hash: Hex | null;
  relay_deposit_tx_hash: Hex | null;
  sweep_serialized_tx: Hex | null;
  relay_serialized_tx: Hex | null;
  failure_reason: string | null;
  relay_status_data: any | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

let running = false;

const validKey = (key: string) => /^0x[\da-fA-F]{64}$/.test(key);

export const enabled = () =>
  Boolean(
    env.privateBridgeEnabled &&
      validKey(env.privateBridgeVaultPrivateKey) &&
      validKey(env.privateBridgePayoutPrivateKey),
  );

export const vaultAccount = () =>
  privateKeyToAccount(env.privateBridgeVaultPrivateKey as Hex);

export const payoutAccount = () =>
  privateKeyToAccount(env.privateBridgePayoutPrivateKey as Hex);

export function addresses() {
  return {
    vaultAddress: vaultAccount().address,
    payoutAddress: payoutAccount().address,
  };
}

const client = createPublicClient({
  transport: http(env.rhcRpcUrl, { timeout: 10_000, retryCount: 1 }),
});

const known = (e: unknown) =>
  /already known|known transaction|nonce too low/i.test(
    e instanceof Error ? e.message : String(e),
  );

async function receipt(hash: Hex) {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch {
    return null;
  }
}

async function confirmed(hash: Hex) {
  const r = await receipt(hash);
  if (!r) return null;
  if (r.status !== "success") throw Error("Routing transaction reverted on chain.");
  const head = await client.getBlockNumber();
  return head - r.blockNumber + 1n >= BigInt(env.privateBridgeConfirmations) ? r : null;
}

async function nativeMatches(hash: Hex, from: Address, to: Address, amount: bigint) {
  const r = await confirmed(hash);
  if (!r || getAddress(r.from) !== from || getAddress(r.to!) !== to) return false;
  const tx = await client.getTransaction({ hash });
  return tx.value === amount;
}

export async function depositReady(job: PrivateBridgeJob) {
  if (!job.deposit_tx_hash) return false;
  return nativeMatches(
    job.deposit_tx_hash,
    getAddress(job.sender_address),
    getAddress(job.vault_address),
    BigInt(job.amount),
  );
}

export async function fetchRelayQuoteForPayout(job: PrivateBridgeJob) {
  const raw = await relay("/quote/v2", {
    user: job.payout_address,
    recipient: job.recipient_address,
    originChainId: 4663,
    destinationChainId: job.destination_chain_id,
    originCurrency: NATIVE,
    destinationCurrency: job.destination_currency,
    amount: job.amount,
    tradeType: "EXACT_INPUT",
    slippageTolerance: "50",
    usePermit: false,
    explicitDeposit: true,
    refundTo: job.payout_address,
  });
  return raw;
}

async function signSweep(job: PrivateBridgeJob) {
  if (!pool) throw Error("Private routing ledger unavailable.");
  const signer = vaultAccount();
  const destination = getAddress(job.payout_address);
  const amount = BigInt(job.amount);

  const [nonce, rawGasPrice] = await Promise.all([
    client.getTransactionCount({ address: signer.address, blockTag: "pending" }),
    client.getGasPrice(),
  ]);
  const gasPrice = (rawGasPrice * 130n) / 100n + 1000000n;

  const raw = await signer.signTransaction({
    to: destination,
    value: amount,
    data: "0x" as Hex,
    nonce,
    gas: 21000n,
    gasPrice,
    chainId: env.rhcChainId,
  });

  const hash = keccak256(raw);
  await pool.query(
    `UPDATE private_bridge_jobs SET status='sweep_signed', sweep_serialized_tx=$2, sweep_tx_hash=$3, updated_at=NOW() WHERE id=$1 AND status='deposit_confirmed'`,
    [job.id, raw, hash],
  );
  return { ...job, sweep_serialized_tx: raw, sweep_tx_hash: hash, status: "sweep_signed" } as PrivateBridgeJob;
}

async function sendSweep(job: PrivateBridgeJob) {
  if (!pool) throw Error("Private routing ledger unavailable.");
  const raw = job.sweep_serialized_tx;
  if (!raw) throw Error("Missing persisted sweep transaction.");
  let hash = keccak256(raw);
  try {
    hash = await client.sendRawTransaction({ serializedTransaction: raw });
  } catch (e) {
    if (!known(e)) {
      if (/underpriced|max fee per gas less than block base fee|fee too low/i.test(e instanceof Error ? e.message : String(e))) {
        await pool.query(
          `UPDATE private_bridge_jobs SET status='deposit_confirmed', sweep_serialized_tx=NULL, updated_at=NOW() WHERE id=$1`,
          [job.id],
        );
      }
      throw e;
    }
  }
  await pool.query(
    `UPDATE private_bridge_jobs SET status='sweep_broadcast', sweep_tx_hash=$2, updated_at=NOW() WHERE id=$1`,
    [job.id, hash],
  );
}

async function signRelayDeposit(job: PrivateBridgeJob) {
  if (!pool) throw Error("Private routing ledger unavailable.");
  const signer = payoutAccount();
  const quote = await fetchRelayQuoteForPayout(job);

  const depositStep = quote.steps?.find((s: any) => s.id === "deposit");
  const stepItem = depositStep?.items?.[0]?.data;
  if (!depositStep || !stepItem) {
    throw Error("Relay quote missing valid deposit transaction step.");
  }

  const depository = getAddress(stepItem.to);
  if (depository.toLowerCase() !== DEPOSITORY.toLowerCase()) {
    throw Error("Relay quote depository address mismatch.");
  }

  const value = BigInt(stepItem.value);
  if (value !== BigInt(job.amount)) {
    throw Error("Relay quote deposit value does not match requested job amount.");
  }

  const calldata = stepItem.data as Hex;
  if (!calldata.toLowerCase().startsWith("0x49290c1c")) {
    throw Error("Relay quote calldata format unexpected for native ETH deposit.");
  }

  const requestId = quote.requestId;
  const [nonce, rawGasPrice] = await Promise.all([
    client.getTransactionCount({ address: signer.address, blockTag: "pending" }),
    client.getGasPrice(),
  ]);
  const gasPrice = (rawGasPrice * 130n) / 100n + 1000000n;

  const raw = await signer.signTransaction({
    to: depository,
    value,
    data: calldata,
    nonce,
    gas: 60000n,
    gasPrice,
    chainId: env.rhcChainId,
  });

  const hash = keccak256(raw);
  await pool.query(
    `UPDATE private_bridge_jobs SET status='relay_signed', relay_request_id=$2, relay_serialized_tx=$3, relay_deposit_tx_hash=$4, updated_at=NOW() WHERE id=$1`,
    [job.id, requestId, raw, hash],
  );
  return {
    ...job,
    relay_request_id: requestId,
    relay_serialized_tx: raw,
    relay_deposit_tx_hash: hash,
    status: "relay_signed",
  } as PrivateBridgeJob;
}

async function sendRelayDeposit(job: PrivateBridgeJob) {
  if (!pool) throw Error("Private routing ledger unavailable.");
  const raw = job.relay_serialized_tx;
  if (!raw) throw Error("Missing persisted relay deposit transaction.");
  let hash = keccak256(raw);
  try {
    hash = await client.sendRawTransaction({ serializedTransaction: raw });
  } catch (e) {
    if (!known(e)) {
      if (/underpriced|max fee per gas less than block base fee|fee too low/i.test(e instanceof Error ? e.message : String(e))) {
        await pool.query(
          `UPDATE private_bridge_jobs SET status=CASE WHEN vault_address = payout_address THEN 'deposit_confirmed' ELSE 'sweep_confirmed' END, relay_serialized_tx=NULL, updated_at=NOW() WHERE id=$1`,
          [job.id],
        );
      }
      throw e;
    }
  }
  await pool.query(
    `UPDATE private_bridge_jobs SET status='relay_broadcast', relay_deposit_tx_hash=$2, updated_at=NOW() WHERE id=$1`,
    [job.id, hash],
  );
}

export async function runPrivateBridgeExecutor() {
  if (running || !enabled() || !pool) return;
  running = true;
  const lock = await pool.connect();
  try {
    const got = await lock.query(
      "SELECT pg_try_advisory_lock(hashtext('tera_private_bridge_executor')) AS locked",
    );
    if (!got.rows[0]?.locked) return;

    try {
      // Expire jobs past expiry that never received a deposit
      await pool.query(
        "UPDATE private_bridge_jobs SET status='expired', updated_at=NOW() WHERE status IN ('awaiting_deposit', 'deposit_pending') AND expires_at <= NOW()",
      );

      const rows = await pool.query(
        "SELECT * FROM private_bridge_jobs WHERE status IN ('deposit_pending', 'deposit_confirmed', 'sweep_signed', 'sweep_broadcast', 'sweep_confirmed', 'relay_signed', 'relay_broadcast', 'relay_confirmed', 'relay_in_flight') ORDER BY created_at LIMIT 10",
      );

      for (const job of rows.rows as PrivateBridgeJob[]) {
        try {
          if (job.status === "deposit_pending") {
            if (await depositReady(job)) {
              await pool.query(
                "UPDATE private_bridge_jobs SET status='deposit_confirmed', updated_at=NOW() WHERE id=$1",
                [job.id],
              );
            }
          } else if (job.status === "deposit_confirmed") {
            const sameWallet =
              job.vault_address.toLowerCase() === job.payout_address.toLowerCase();
            if (sameWallet) {
              // Direct Relay deposit without intermediate sweep
              const signed = await signRelayDeposit(job);
              await sendRelayDeposit(signed);
            } else {
              // Sweep to payout wallet first
              const signed = await signSweep(job);
              await sendSweep(signed);
            }
          } else if (job.status === "sweep_signed") {
            await sendSweep(job);
          } else if (job.status === "sweep_broadcast") {
            const ok = await nativeMatches(
              job.sweep_tx_hash!,
              getAddress(job.vault_address),
              getAddress(job.payout_address),
              BigInt(job.amount),
            );
            if (ok) {
              await pool.query(
                "UPDATE private_bridge_jobs SET status='sweep_confirmed', updated_at=NOW() WHERE id=$1",
                [job.id],
              );
            }
          } else if (job.status === "sweep_confirmed") {
            const signed = await signRelayDeposit(job);
            await sendRelayDeposit(signed);
          } else if (job.status === "relay_signed") {
            await sendRelayDeposit(job);
          } else if (job.status === "relay_broadcast") {
            const r = await confirmed(job.relay_deposit_tx_hash!);
            if (r) {
              await pool.query(
                "UPDATE private_bridge_jobs SET status='relay_in_flight', updated_at=NOW() WHERE id=$1",
                [job.id],
              );
            }
          } else if (job.status === "relay_in_flight") {
            if (!job.relay_request_id) continue;
            try {
              const statusData = await relay(
                `/intents/status/v3?requestId=${encodeURIComponent(job.relay_request_id)}`,
              );
              const relayStatus = statusData?.status;
              if (relayStatus === "success") {
                await pool.query(
                  "UPDATE private_bridge_jobs SET status='confirmed', relay_status_data=$2, confirmed_at=NOW(), updated_at=NOW() WHERE id=$1",
                  [job.id, JSON.stringify(statusData)],
                );
              } else if (relayStatus === "refunded") {
                await pool.query(
                  "UPDATE private_bridge_jobs SET status='refunded', failure_reason='Refunded by Relay', relay_status_data=$2, updated_at=NOW() WHERE id=$1",
                  [job.id, JSON.stringify(statusData)],
                );
              } else {
                await pool.query(
                  "UPDATE private_bridge_jobs SET relay_status_data=$2, updated_at=NOW() WHERE id=$1",
                  [job.id, JSON.stringify(statusData)],
                );
              }
            } catch (err) {
              // Transient Relay status error, retry on next interval
              console.warn("Error polling Relay intent status:", job.id, err);
            }
          }
        } catch (e) {
          const reason = e instanceof Error ? e.message : "Private bridge processing failed";
          if (/reverted/i.test(reason)) {
            await pool.query(
              "UPDATE private_bridge_jobs SET status='failed', failure_reason=$2, updated_at=NOW() WHERE id=$1",
              [job.id, reason],
            );
          }
          console.error("Private bridge job failed", job.id, e);
        }
      }
    } finally {
      await lock.query(
        "SELECT pg_advisory_unlock(hashtext('tera_private_bridge_executor'))",
      );
    }
  } finally {
    lock.release();
    running = false;
  }
}

export function startPrivateBridgeExecutor() {
  if (!enabled()) return;
  void runPrivateBridgeExecutor();
  setInterval(() => void runPrivateBridgeExecutor(), env.privateBridgeJobIntervalMs).unref();
}

export async function creditPrivateBridgeDeposit(id: string, hash: Hex) {
  if (!pool) throw Error("Private routing ledger unavailable.");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const found = await db.query(
      "SELECT * FROM private_bridge_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    const job = found.rows[0] as PrivateBridgeJob | undefined;
    if (!job) throw Error("Private bridge job not found.");
    if (!["awaiting_deposit", "deposit_pending", "deposit_confirmed"].includes(job.status)) {
      throw Error("Private bridge job cannot accept a deposit.");
    }
    if (new Date(job.expires_at).getTime() < Date.now() && job.status !== "deposit_confirmed") {
      throw Error("Private bridge job expired.");
    }
    if (job.deposit_tx_hash && job.deposit_tx_hash.toLowerCase() !== hash.toLowerCase()) {
      throw Error("A different deposit hash is already attached to this job.");
    }

    const next = { ...job, deposit_tx_hash: hash } as PrivateBridgeJob;
    await db.query(
      "UPDATE private_bridge_jobs SET status=CASE WHEN status='deposit_confirmed' THEN status ELSE 'deposit_pending' END, deposit_tx_hash=$2, updated_at=NOW() WHERE id=$1",
      [id, hash],
    );

    if (!(await depositReady(next))) {
      await db.query("COMMIT");
      return { status: "awaiting_confirmations" };
    }

    await db.query(
      "UPDATE private_bridge_jobs SET status='deposit_confirmed', deposit_tx_hash=$2, updated_at=NOW() WHERE id=$1",
      [id, hash],
    );
    await db.query("COMMIT");
    return { status: "deposit_confirmed" };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}
