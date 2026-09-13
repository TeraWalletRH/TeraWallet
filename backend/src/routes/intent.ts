import { Router, type Request, type Response } from "express";
import { type UserIntent } from "../pipeline/types";
import { runGatePipeline } from "../pipeline/gates";
import { buildPreparedTransaction } from "../pipeline/builder";
import pool from "../db";
import { keccak256, stringToBytes } from "viem";

const router = Router();

// In-memory receipt cache when DB is not connected
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
    const preparedTransaction = buildPreparedTransaction(intent, accountAddress, gates);

    res.status(200).json({
      success: true,
      preparedTransaction,
      gates,
    });
  } catch (error) {
    console.error("Failed to prepare intent transaction:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during intent preparation",
    });
  }
});

/**
 * POST /api/intent/receipt
 * Records the transaction hash broadcast by the owner wallet.
 */
router.post("/api/intent/receipt", async (req: Request, res: Response) => {
  try {
    const { actionHash, txHash, recipient, intentId } = req.body;

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
        await pool.query(
          `INSERT INTO audit_receipts (action_hash, tx_hash, recipient)
           VALUES ($1, $2, $3)`,
          [actionHash, txHash, recipient ?? ""]
        );
      }
    } catch {
      // Fall back to memory receipts
      memoryReceipts.push({ receiptId, actionHash, txHash, recipient, timestamp: new Date().toISOString() });
    }

    res.status(201).json({
      success: true,
      receiptId,
      actionHash,
      txHash,
      status: "CONFIRMED",
    });
  } catch (error) {
    console.error("Failed to record transaction receipt:", error);
    res.status(500).json({
      success: false,
      error: "Failed to record transaction receipt",
    });
  }
});

export default router;
