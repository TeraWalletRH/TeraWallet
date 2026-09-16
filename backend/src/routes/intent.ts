import { Router, type Request, type Response } from "express";
import { type UserIntent } from "../pipeline/types";
import { runGatePipeline } from "../pipeline/gates";
import { buildPreparedTransaction, UnsupportedActionError } from "../pipeline/builder";
import pool from "../db";
import { env } from "../env";
import { keccak256, stringToBytes } from "viem";
import { logger } from "../logging";

const router = Router();

// In-memory intent & receipt fallback
const memoryIntents: Record<string, any> = {};
const memoryReceipts: Array<Record<string, unknown>> = [];

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

    let intentId: string | null = null;

    // Persist to PostgreSQL if available
    try {
      if (pool) {
        // Ensure account exists
        await pool.query(
          `INSERT INTO accounts (owner_address, account_address, chain_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (account_address) DO NOTHING`,
          [intent.ownerAddress, accountAddress, env.rhcChainId]
        );

        // Insert intent record
        const intentRes = await pool.query(
          `INSERT INTO intents (
             account_address, agent_id, intent_type, status, asset_address,
             raw_intent, action_hash, prepared_tx
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (action_hash) DO UPDATE
             SET status = 'prepared', prepared_tx = $8, updated_at = NOW()
           RETURNING id`,
          [
            accountAddress,
            "tera-agent-supervised",
            intent.actionType,
            "prepared",
            intent.assetAddress,
            JSON.stringify(intent),
            preparedTransaction.actionHash,
            JSON.stringify(preparedTransaction),
          ]
        );

        if (intentRes.rows.length > 0) {
          intentId = intentRes.rows[0].id;

          // Record preflight check results
          const preflightGate = gates.find((g) => g.gate === "eligibility_preflight");
          const policyGate = gates.find((g) => g.gate === "policy_vault");
          const riskGate = gates.find((g) => g.gate === "risk_engine");

          await pool.query(
            `INSERT INTO preflight_checks (
               intent_id, token_standard, can_transfer, compliance_details, policy_passed, risk_passed
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              intentId,
              "ERC-3643",
              preflightGate?.passed ?? false,
              JSON.stringify(preflightGate?.details ?? {}),
              policyGate?.passed ?? false,
              riskGate?.passed ?? false,
            ]
          );
        }
      }
    } catch (dbErr) {
      logger.warn(req, "intent.persistence_fallback", dbErr);
    }

    if (!intentId) {
      intentId = keccak256(stringToBytes(preparedTransaction.actionHash)).slice(0, 18);
    }

    memoryIntents[preparedTransaction.actionHash] = {
      intentId,
      intent,
      accountAddress,
      preparedTransaction,
      gates,
      status: "prepared",
      createdAt: new Date().toISOString(),
    };

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
 * Records the transaction hash broadcast by the owner wallet.
 */
router.post("/api/intent/receipt", async (req: Request, res: Response) => {
  try {
    const { actionHash, txHash, recipient, intentId: passedIntentId } = req.body;

    if (!actionHash || !txHash) {
      res.status(400).json({
        success: false,
        error: "actionHash and txHash are required to record a receipt",
      });
      return;
    }

    const receiptId = keccak256(stringToBytes(`${actionHash}-${txHash}-${Date.now()}`)).slice(0, 18);

    try {
      if (pool) {
        let resolvedIntentId = passedIntentId;

        // If intentId not passed, resolve from intents table by action_hash
        if (!resolvedIntentId) {
          const findIntent = await pool.query(
            `SELECT id FROM intents WHERE action_hash = $1 LIMIT 1`,
            [actionHash]
          );
          if (findIntent.rows.length > 0) {
            resolvedIntentId = findIntent.rows[0].id;
          }
        }

        // Update intent status to 'confirmed' if intent exists
        if (resolvedIntentId) {
          await pool.query(
            `UPDATE intents SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
            [resolvedIntentId]
          );
        } else {
          await pool.query(
            `UPDATE intents SET status = 'confirmed', updated_at = NOW() WHERE action_hash = $1`,
            [actionHash]
          );
        }

        // Insert into audit_receipts
        await pool.query(
          `INSERT INTO audit_receipts (intent_id, action_hash, tx_hash, recipient)
           VALUES ($1, $2, $3, $4)`,
          [resolvedIntentId ?? null, actionHash, txHash, recipient ?? ""]
        );
      }
    } catch (dbErr) {
      logger.warn(req, "intent.receipt_persistence_fallback", dbErr);
    }

    if (memoryIntents[actionHash]) {
      memoryIntents[actionHash].status = "confirmed";
      memoryIntents[actionHash].txHash = txHash;
    }

    memoryReceipts.push({
      receiptId,
      actionHash,
      txHash,
      recipient,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      receiptId,
      actionHash,
      txHash,
      status: "CONFIRMED",
    });
  } catch (error) {
    logger.error(req, "intent.receipt_failed", error);
    res.status(500).json({
      success: false,
      error: "Failed to record transaction receipt",
    });
  }
});

export default router;
