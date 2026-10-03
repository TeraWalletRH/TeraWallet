import { Router, type Request, type Response } from "express";
import { type GateResult, type PreparedTransaction, type UserIntent } from "../pipeline/types";
import { runGatePipeline } from "../pipeline/gates";
import { buildPreparedTransaction, UnsupportedActionError } from "../pipeline/builder";
import pool from "../db";
import { env } from "../env";
import { createPublicClient, http, isHash, keccak256, stringToBytes, type Hex } from "viem";
import { logger } from "../logging";
import { matchesPreparedReceipt } from "../intent-receipt";

const router = Router();

// In-memory intent & receipt fallback
const memoryIntents: Record<string, any> = {};
const memoryReceipts: Array<Record<string, unknown>> = [];

/** Persist the exact call the owner is offered, including agent proposals. */
export async function savePreparedIntent(
  intent: UserIntent,
  accountAddress: `0x${string}`,
  preparedTransaction: PreparedTransaction,
  gates: GateResult[],
): Promise<string> {
  let intentId = keccak256(stringToBytes(preparedTransaction.actionHash)).slice(0, 18);
  if (pool) {
    await pool.query(
      `INSERT INTO accounts (owner_address, account_address, chain_id)
       VALUES ($1, $2, $3) ON CONFLICT (account_address) DO NOTHING`,
      [intent.ownerAddress, accountAddress, env.rhcChainId],
    );
    const saved = await pool.query(
      `INSERT INTO intents (account_address, agent_id, intent_type, status, asset_address,
         raw_intent, action_hash, prepared_tx)
       VALUES ($1, $2, $3, 'prepared', $4, $5, $6, $7)
       ON CONFLICT (action_hash) DO UPDATE
         SET prepared_tx = EXCLUDED.prepared_tx, updated_at = NOW()
       RETURNING id`,
      [accountAddress, "tera-agent-supervised", intent.actionType, intent.assetAddress,
        JSON.stringify(intent), preparedTransaction.actionHash, JSON.stringify(preparedTransaction)],
    );
    intentId = saved.rows[0].id;
    const preflightGate = gates.find((g) => g.gate === "eligibility_preflight");
    const policyGate = gates.find((g) => g.gate === "policy_vault");
    const riskGate = gates.find((g) => g.gate === "risk_engine");
    await pool.query(
      `INSERT INTO preflight_checks (intent_id, token_standard, can_transfer,
         compliance_details, policy_passed, risk_passed) VALUES ($1, $2, $3, $4, $5, $6)`,
      [intentId, "ERC-3643", preflightGate?.passed ?? false,
        JSON.stringify(preflightGate?.details ?? {}), policyGate?.passed ?? false, riskGate?.passed ?? false],
    );
  }
  memoryIntents[preparedTransaction.actionHash] = {
    intentId, intent, accountAddress, preparedTransaction, gates,
    status: "prepared", createdAt: new Date().toISOString(),
  };
  return intentId;
}

/**
 * POST /api/intent/prepare
 * Evaluates the 5 deterministic gates and returns the encoded transaction payload for the user wallet.
 */
router.post("/api/intent/prepare", async (req: Request, res: Response) => {
  try {
    const intent = req.body as UserIntent;

    if (!intent.ownerAddress || !intent.assetAddress || !intent.actionType || !intent.amount) {
      res.status(400).json({
        success: false,
        error: "Missing required intent fields (ownerAddress, assetAddress, actionType, amount)",
      });
      return;
    }

    // Yield claims are no longer part of Tera's product surface. Reject before
    // any registry or RPC work so the response is deterministic and immediate.
    if (intent.actionType === "CLAIM_YIELD") {
      res.status(501).json({
        success: false,
        error: "Yield claims are discontinued and are not supported.",
        action: "CLAIM_YIELD",
        supported: false,
      });
      return;
    }

    // Run the 5 deterministic gates
    const gates = await runGatePipeline(intent);
    const hasFailedGate = gates.some((g) => !g.passed);

    if (hasFailedGate) {
      const failed = gates.find((g) => !g.passed);
      res.status(422).json({
        success: false,
        error: failed?.reason ?? "Intent was blocked by a deterministic gate",
        gates,
      });
      return;
    }

    // If accountAddress is not provided, use a deterministic mock/counterfactual address
    const accountAddress = intent.accountAddress ?? intent.ownerAddress;

    // Build the prepared transaction payload for user wallet popup
    const preparedTransaction = await buildPreparedTransaction(intent, accountAddress, gates);

    const intentId = await savePreparedIntent(intent, accountAddress, preparedTransaction, gates);

    res.status(200).json({
      success: true,
      intentId,
      actionHash: preparedTransaction.actionHash,
      preparedTransaction,
      gates,
    });
  } catch (error) {
    if (error instanceof UnsupportedActionError) {
      const status = error.action === "SWAP_QUOTE_RPC_UNAVAILABLE" ? 503 : error.action.startsWith("SWAP") ? 422 : 501;
      res.status(status).json({
        success: false,
        error: error.message,
        action: error.action,
        supported: false,
        quoteUnavailable: error.action.startsWith("SWAP"),
      });
      return;
    }
    logger.error(req, "intent.prepare_failed", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during intent preparation",
    });
  }
});

/**
 * GET /api/intent/:actionHash
 * Retrieves intent status and preflight compliance information.
 */
router.get("/api/intent/:actionHash", async (req: Request, res: Response) => {
  const actionHash = String(req.params.actionHash);

  try {
    if (pool) {
      const intentRes = await pool.query(
        `SELECT i.id, i.account_address, i.agent_id, i.intent_type, i.status,
                i.asset_address, i.raw_intent, i.action_hash, i.prepared_tx, i.created_at,
                r.tx_hash, r.recipient, r.created_at as confirmed_at
         FROM intents i
         LEFT JOIN audit_receipts r ON i.id = r.intent_id OR i.action_hash = r.action_hash
         WHERE i.action_hash = $1
         LIMIT 1`,
        [actionHash]
      );

      if (intentRes.rows.length > 0) {
        const row = intentRes.rows[0];
        res.status(200).json({
          success: true,
          intent: row,
        });
        return;
      }
    }
  } catch (dbErr) {
    logger.warn(req, "intent.query_fallback", dbErr);
  }

  const memory = memoryIntents[actionHash];
  if (memory) {
    res.status(200).json({
      success: true,
      intent: memory,
    });
    return;
  }

  res.status(404).json({
    success: false,
    error: `Intent with actionHash '${actionHash}' not found`,
  });
});

/**
 * POST /api/intent/receipt
 * Records a successful on-chain call matching the stored prepared transaction.
 */
router.post("/api/intent/receipt", async (req: Request, res: Response) => {
  try {
    const { actionHash, txHash, intentId: suppliedIntentId } = req.body ?? {};
    if (typeof actionHash !== "string" || !isHash(actionHash) ||
        typeof txHash !== "string" || !isHash(txHash)) {
      res.status(400).json({ success: false, error: "Valid actionHash and txHash are required." });
      return;
    }
    if (!pool && env.nodeEnv === "production") {
      res.status(503).json({ success: false, error: "Receipt ledger is unavailable." });
      return;
    }

    const record = pool
      ? (await pool.query(
          "SELECT id, status, prepared_tx, created_at FROM intents WHERE action_hash = $1",
          [actionHash],
        )).rows[0]
      : memoryIntents[actionHash];
    if (!record) {
      res.status(404).json({ success: false, error: "Prepared intent not found." });
      return;
    }
    const intentId = String(record.id ?? record.intentId);
    if (suppliedIntentId !== undefined && suppliedIntentId !== intentId) {
      res.status(422).json({ success: false, error: "intentId does not match actionHash." });
      return;
    }
    const prepared = (record.prepared_tx ?? record.preparedTransaction) as PreparedTransaction | undefined;
    if (!prepared || prepared.actionHash?.toLowerCase() !== actionHash.toLowerCase()) {
      res.status(422).json({ success: false, error: "Stored prepared transaction is invalid." });
      return;
    }

    const client = createPublicClient({ transport: http(env.rhcRpcUrl, { timeout: 10_000, retryCount: 1 }) });
    const [chainId, transaction, receipt] = await Promise.all([
      client.getChainId(),
      client.getTransaction({ hash: txHash as Hex }),
      client.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null),
    ]);
    if (!receipt) {
      res.status(409).json({ success: false, error: "Transaction is not confirmed." });
      return;
    }
    if (chainId !== env.rhcChainId || !matchesPreparedReceipt(
      prepared, transaction, receipt, txHash as Hex, env.rhcChainId,
    )) {
      res.status(422).json({ success: false, error: "Transaction does not match the prepared intent." });
      return;
    }
    const block = await client.request({ method: "eth_getBlockByHash", params: [receipt.blockHash, false] });
    const preparedAt = Date.parse(String(record.created_at ?? record.createdAt));
    const minedAt = block?.timestamp ? Number(BigInt(block.timestamp)) * 1000 : NaN;
    if (!block || block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
        !Number.isFinite(preparedAt) || !Number.isFinite(minedAt) ||
        minedAt < Math.floor(preparedAt / 1000) * 1000) {
      res.status(422).json({ success: false, error: "Transaction predates the prepared intent." });
      return;
    }

    let receiptId: string;
    let alreadyRecorded = false;
    if (pool) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [txHash.toLowerCase()]);
        const locked = await db.query(
          "SELECT id, status, prepared_tx, created_at FROM intents WHERE action_hash = $1 FOR UPDATE",
          [actionHash],
        );
        const current = locked.rows[0];
        if (!current || String(current.id) !== intentId || !current.prepared_tx ||
            Date.parse(String(current.created_at)) !== preparedAt ||
            !matchesPreparedReceipt(current.prepared_tx, transaction, receipt, txHash as Hex, env.rhcChainId)) {
          throw new Error("Prepared intent changed during confirmation.");
        }
        const existing = await db.query(
          "SELECT id, intent_id, tx_hash FROM audit_receipts WHERE intent_id = $1 OR LOWER(tx_hash) = LOWER($2) FOR UPDATE",
          [intentId, txHash],
        );
        if (existing.rows.some((row) => String(row.intent_id) !== intentId ||
            String(row.tx_hash).toLowerCase() !== txHash.toLowerCase())) {
          await db.query("ROLLBACK");
          res.status(409).json({ success: false, error: "Intent or transaction already has a different receipt." });
          return;
        }
        if (existing.rows.length) {
          receiptId = String(existing.rows[0].id);
          alreadyRecorded = true;
        } else {
          if (current.status !== "prepared") {
            await db.query("ROLLBACK");
            res.status(409).json({ success: false, error: "Intent is not awaiting confirmation." });
            return;
          }
          const inserted = await db.query(
            `INSERT INTO audit_receipts (intent_id, action_hash, tx_hash, recipient)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [intentId, actionHash, txHash, prepared.intent.recipient ?? prepared.intent.ownerAddress],
          );
          receiptId = String(inserted.rows[0].id);
          await db.query("UPDATE intents SET status = 'confirmed', updated_at = NOW() WHERE id = $1", [intentId]);
        }
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        db.release();
      }
    } else {
      const existing = memoryReceipts.find((row) => row.actionHash === actionHash || row.txHash === txHash);
      if (existing && (existing.actionHash !== actionHash || existing.txHash !== txHash)) {
        res.status(409).json({ success: false, error: "Intent or transaction already has a different receipt." });
        return;
      }
      if (record.status !== "prepared" && !existing) {
        res.status(409).json({ success: false, error: "Intent is not awaiting confirmation." });
        return;
      }
      receiptId = existing ? String(existing.receiptId) : keccak256(stringToBytes(`${actionHash}-${txHash}`)).slice(0, 18);
      alreadyRecorded = Boolean(existing);
      if (!existing) memoryReceipts.push({ receiptId, actionHash, txHash });
      record.status = "confirmed";
      record.txHash = txHash;
    }

    res.status(alreadyRecorded ? 200 : 201).json({ success: true, receiptId, actionHash, txHash, status: "CONFIRMED" });
  } catch (error) {
    logger.error(req, "intent.receipt_failed", error);
    res.status(503).json({
      success: false,
      error: "Unable to verify or record transaction receipt.",
    });
  }
});

export default router;
