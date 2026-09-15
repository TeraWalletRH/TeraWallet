import { Router, type Request, type Response } from "express";
import pool from "../db";
import { env } from "../env";
import { logger } from "../logging";

const router = Router();

// In-memory fallback
const memoryAccounts: Record<string, { ownerAddress: string; accountAddress: string; chainId: number; createdAt: string }> = {};

/**
 * POST /api/account/register
 * Registers or connects a smart account for an owner EOA.
 */
router.post("/api/account/register", async (req: Request, res: Response) => {
  try {
    const { ownerAddress, accountAddress, chainId = env.rhcChainId } = req.body;

    if (!ownerAddress || !accountAddress) {
      res.status(400).json({
        success: false,
        error: "ownerAddress and accountAddress are required",
      });
      return;
    }

    try {
      if (pool) {
        const result = await pool.query(
          `INSERT INTO accounts (owner_address, account_address, chain_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (account_address) DO UPDATE
             SET updated_at = NOW(), is_active = TRUE
           RETURNING id, owner_address, account_address, chain_id, is_active, created_at, updated_at`,
          [ownerAddress, accountAddress, chainId]
        );

        res.status(200).json({
          success: true,
          account: result.rows[0],
        });
        return;
      }
    } catch (dbErr) {
      logger.warn(req, "account.registration_fallback", dbErr);
    }

    const lower = accountAddress.toLowerCase();
    memoryAccounts[lower] = {
      ownerAddress,
      accountAddress,
      chainId,
      createdAt: new Date().toISOString(),
    };

    res.status(200).json({
      success: true,
      account: memoryAccounts[lower],
    });
  } catch (error) {
    logger.error(req, "account.registration_failed", error);
    res.status(500).json({ success: false, error: "Internal error registering account" });
  }
});

/**
 * GET /api/account/:address
 * Fetches account overview including session keys and stats.
 */
router.get("/api/account/:address", async (req: Request, res: Response) => {
  const address = String(req.params.address);

  try {
    if (pool) {
      const accountRes = await pool.query(
        `SELECT id, owner_address, account_address, chain_id, is_active, created_at
         FROM accounts
         WHERE account_address = $1 OR owner_address = $1
         LIMIT 1`,
        [address]
      );

      const targetAccount = accountRes.rows[0]?.account_address ?? address;

      const sessionsRes = await pool.query(
        `SELECT COUNT(*) as total_sessions,
                COUNT(*) FILTER (WHERE is_revoked = FALSE AND expires_at > NOW()) as active_sessions
         FROM session_keys
         WHERE account_address = $1`,
        [targetAccount]
      );

      const intentsRes = await pool.query(
        `SELECT COUNT(*) as total_intents,
                COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_intents
         FROM intents
         WHERE account_address = $1`,
        [targetAccount]
      );

      res.status(200).json({
        success: true,
        account: accountRes.rows[0] ?? {
          account_address: targetAccount,
          chain_id: env.rhcChainId,
          is_active: true,
        },
        stats: {
          sessions: sessionsRes.rows[0] ?? { total_sessions: 0, active_sessions: 0 },
          intents: intentsRes.rows[0] ?? { total_intents: 0, confirmed_intents: 0 },
        },
      });
      return;
    }
  } catch (dbErr) {
      logger.warn(req, "account.fetch_fallback", dbErr);
  }

  const memory = memoryAccounts[address.toLowerCase()];
  res.status(200).json({
    success: true,
    account: memory ?? {
      account_address: address,
      chain_id: env.rhcChainId,
      is_active: true,
    },
    stats: {
      sessions: { total_sessions: 0, active_sessions: 0 },
      intents: { total_intents: 0, confirmed_intents: 0 },
    },
  });
});

/**
 * GET /api/account/:address/history
 * Returns full audit history of intents and receipts for an account.
 */
router.get("/api/account/:address/history", async (req: Request, res: Response) => {
  const address = String(req.params.address);

  try {
    if (pool) {
      const result = await pool.query(
        `SELECT i.id, i.account_address, i.agent_id, i.intent_type, i.status,
                i.asset_address, i.raw_intent, i.action_hash, i.created_at,
                r.tx_hash, r.recipient, r.created_at as confirmed_at
         FROM intents i
         LEFT JOIN audit_receipts r ON i.id = r.intent_id OR i.action_hash = r.action_hash
         WHERE i.account_address = $1
         ORDER BY i.created_at DESC
         LIMIT 50`,
        [address]
      );

      res.status(200).json({
        success: true,
        count: result.rows.length,
        history: result.rows,
      });
      return;
    }
  } catch (dbErr) {
      logger.warn(req, "account.history_fallback", dbErr);
  }

  res.status(200).json({
    success: true,
    count: 0,
    history: [],
  });
});

export default router;
