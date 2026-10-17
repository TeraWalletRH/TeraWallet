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

// In-memory deletion storage fallback
interface DeletionSchedule {
  accountAddress: string;
  scope: string;
  walletIndex?: number;
  reason?: string;
  status: "pending_deletion" | "recovered" | "purged";
  requestedAt: string;
  expiresAt: string;
}
const memoryDeletions: Record<string, DeletionSchedule> = {};

/**
 * POST /api/account/deletion/request
 * Schedules an account or specific sub-wallet for deletion with a 30-day recovery period.
 */
router.post("/api/account/deletion/request", async (req: Request, res: Response) => {
  try {
    const { accountAddress, scope = "full", walletIndex, reason } = req.body;
    if (!accountAddress) {
      res.status(400).json({ success: false, error: "accountAddress is required" });
      return;
    }

    const lower = String(accountAddress).toLowerCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const parsedIndex = walletIndex !== undefined && walletIndex !== "" ? Number(walletIndex) : null;

    if (pool) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS account_deletions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_address VARCHAR(42) NOT NULL,
            owner_address VARCHAR(42),
            scope VARCHAR(32) NOT NULL DEFAULT 'full',
            wallet_index INTEGER,
            status VARCHAR(32) NOT NULL DEFAULT 'pending_deletion',
            reason TEXT,
            requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
            recovered_at TIMESTAMPTZ,
            purged_at TIMESTAMPTZ
          )
        `);

        const insertRes = await pool.query(
          `INSERT INTO account_deletions (account_address, scope, wallet_index, reason, status, requested_at, expires_at)
           VALUES ($1, $2, $3, $4, 'pending_deletion', NOW(), NOW() + INTERVAL '30 days')
           RETURNING id, account_address, scope, wallet_index, status, requested_at, expires_at`,
          [lower, scope, parsedIndex, reason || null]
        );

        res.status(200).json({
          success: true,
          message: "Deletion scheduled. Recoverable for 30 days.",
          record: insertRes.rows[0],
          daysRemaining: 30,
        });
        return;
      } catch (dbErr) {
        logger.warn(req, "account.deletion_db_fallback", dbErr);
      }
    }

    memoryDeletions[lower] = {
      accountAddress: lower,
      scope,
      walletIndex: parsedIndex ?? undefined,
      reason,
      status: "pending_deletion",
      requestedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    res.status(200).json({
      success: true,
      message: "Deletion scheduled. Recoverable for 30 days.",
      record: memoryDeletions[lower],
      daysRemaining: 30,
    });
  } catch (error) {
    logger.error(req, "account.deletion_request_failed", error);
    res.status(500).json({ success: false, error: "Failed to schedule deletion" });
  }
});

/**
 * POST /api/account/deletion/recover
 * Recovers an account or sub-wallet within the 30-day grace period.
 */
router.post("/api/account/deletion/recover", async (req: Request, res: Response) => {
  try {
    const { accountAddress } = req.body;
    if (!accountAddress) {
      res.status(400).json({ success: false, error: "accountAddress is required" });
      return;
    }

    const lower = String(accountAddress).toLowerCase();

    if (pool) {
      try {
        const updateRes = await pool.query(
          `UPDATE account_deletions
           SET status = 'recovered', recovered_at = NOW()
           WHERE account_address = $1 AND status = 'pending_deletion' AND expires_at > NOW()
           RETURNING id, account_address, status, recovered_at`,
          [lower]
        );

        if (updateRes.rowCount && updateRes.rowCount > 0) {
          res.status(200).json({
            success: true,
            message: "Account restored successfully. Deletion has been cancelled.",
            record: updateRes.rows[0],
          });
          return;
        }
      } catch (dbErr) {
        logger.warn(req, "account.recovery_db_fallback", dbErr);
      }
    }

    const existing = memoryDeletions[lower];
    if (existing && existing.status === "pending_deletion") {
      const now = new Date();
      if (new Date(existing.expiresAt) > now) {
        existing.status = "recovered";
        res.status(200).json({
          success: true,
          message: "Account restored successfully. Deletion has been cancelled.",
          record: existing,
        });
        return;
      }
    }

    res.status(200).json({
      success: true,
      message: "Account is active or already restored.",
    });
  } catch (error) {
    logger.error(req, "account.recovery_failed", error);
    res.status(500).json({ success: false, error: "Failed to recover account" });
  }
});

/**
 * GET /api/account/deletion/status/:address
 * Checks deletion status and remaining grace period days.
 */
router.get("/api/account/deletion/status/:address", async (req: Request, res: Response) => {
  try {
    const address = String(req.params.address).toLowerCase();

    if (pool) {
      try {
        const queryRes = await pool.query(
          `SELECT id, account_address, scope, wallet_index, status, requested_at, expires_at
           FROM account_deletions
           WHERE account_address = $1
           ORDER BY requested_at DESC
           LIMIT 1`,
          [address]
        );

        if (queryRes.rows.length > 0) {
          const rec = queryRes.rows[0];
          const expires = new Date(rec.expires_at).getTime();
          const now = Date.now();
          const daysRemaining = Math.max(0, Math.ceil((expires - now) / (1000 * 60 * 60 * 24)));

          res.status(200).json({
            success: true,
            record: rec,
            isPending: rec.status === "pending_deletion" && expires > now,
            daysRemaining,
          });
          return;
        }
      } catch (dbErr) {
        logger.warn(req, "account.status_db_fallback", dbErr);
      }
    }

    const rec = memoryDeletions[address];
    if (rec) {
      const expires = new Date(rec.expiresAt).getTime();
      const now = Date.now();
      const daysRemaining = Math.max(0, Math.ceil((expires - now) / (1000 * 60 * 60 * 24)));

      res.status(200).json({
        success: true,
        record: rec,
        isPending: rec.status === "pending_deletion" && expires > now,
        daysRemaining,
      });
      return;
    }

    res.status(200).json({
      success: true,
      isPending: false,
      message: "No scheduled deletion found for this account.",
    });
  } catch (error) {
    logger.error(req, "account.deletion_status_failed", error);
    res.status(500).json({ success: false, error: "Failed to check deletion status" });
  }
});

export default router;
