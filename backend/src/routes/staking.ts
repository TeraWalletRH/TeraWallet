import { Router, type Request, type Response } from "express";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import pool from "../db";
import { env } from "../env";
import { logger } from "../logging";

const router = Router();

function poolAddress() {
  const key = env.teraStakingPoolPrivateKey;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key as `0x${string}`).address;
}

function configured() {
  return Boolean(
    env.teraStakingEnabled &&
      isAddress(env.teraTokenAddress) &&
      poolAddress() &&
      env.masterAdminKey &&
      Number.isInteger(env.teraStakingConfirmations) &&
      env.teraStakingConfirmations > 0,
  );
}

/** Public configuration only: no key, admin secret, or funding claim is exposed. */
router.get("/api/staking/config", (_req: Request, res: Response) => {
  const active = configured();
  res.status(200).json({
    success: true,
    status: active ? "configured" : "disabled",
    tokenAddress: isAddress(env.teraTokenAddress) ? env.teraTokenAddress : null,
    poolAddress: active ? poolAddress() : null,
    confirmationsRequired: active ? env.teraStakingConfirmations : null,
    // Configuration is not activation. An epoch is only live after a verified
    // funding transaction has been recorded by the admin flow.
    activation: "A verified, funded epoch is required before deposits can be credited.",
  });
});

router.get("/api/staking/position/:walletAddress", async (req: Request, res: Response) => {
  const walletAddress = String(req.params.walletAddress);
  if (!isAddress(walletAddress)) {
    res.status(400).json({ success: false, error: "walletAddress must be a valid EVM address." });
    return;
  }
  try {
    if (!pool) {
      res.status(200).json({ success: true, positions: [], source: "no-ledger" });
      return;
    }
    const result = await pool.query(
      `SELECT p.epoch_id, p.active_stake, p.accrued_rewards, p.reward_debt, p.updated_at,
              e.status AS epoch_status, e.starts_at, e.ends_at, e.token_address
         FROM staking_positions p
         JOIN staking_epochs e ON e.id = p.epoch_id
        WHERE LOWER(p.wallet_address) = LOWER($1)
        ORDER BY e.ends_at DESC`,
      [walletAddress],
    );
    res.status(200).json({ success: true, positions: result.rows, source: "ledger" });
  } catch (error) {
    logger.error(req, "staking.position_read_failed", error);
    res.status(503).json({ success: false, error: "Staking ledger is unavailable." });
  }
});

export default router;
