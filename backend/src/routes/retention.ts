import { Router, type Request, type Response } from "express";
import { isAddress, verifyMessage } from "viem";
import pool from "../db";
import { logger } from "../logging";

const router = Router();

// Prepared assistant intents can be redacted by their owner. Confirmed intent
// and receipt rows remain available for transaction and compliance history.
router.delete("/api/account/:address/assistant-data", async (req: Request, res: Response) => {
  const address = String(req.params.address);
  const signature = String(req.body?.signature ?? "");
  const timestamp = Number(req.body?.timestamp);
  if (!isAddress(address, { strict: false }) || !/^0x[\da-f]{130}$/i.test(signature) || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) {
    res.status(400).json({ success: false, error: "A recent wallet signature is required." });
    return;
  }
  const message = `Tera Wallet data deletion\nWallet: ${address.toLowerCase()}\nTimestamp: ${timestamp}`;
  try {
    if (!(await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }))) {
      res.status(401).json({ success: false, error: "Wallet signature did not match this account." });
      return;
    }
  } catch {
    res.status(401).json({ success: false, error: "Wallet signature did not match this account." });
    return;
  }
  try {
    if (!pool) {
      res.json({ success: true, redactedIntents: 0 });
      return;
    }
    const result = await pool.query(
      `UPDATE intents SET raw_intent = '{}'::jsonb, route = NULL, prepared_tx = '{}'::jsonb,
              agent_id = 'deleted', status = 'redacted', updated_at = NOW()
       WHERE status <> 'confirmed' AND account_address IN
         (SELECT account_address FROM accounts WHERE owner_address = $1 OR account_address = $1)`,
      [address],
    );
    res.json({ success: true, redactedIntents: result.rowCount ?? 0 });
  } catch (error) {
    logger.warn(req, "retention.deletion_failed", error);
    res.status(503).json({ success: false, error: "Stored assistant proposal data could not be deleted. Try again." });
  }
});

export default router;
