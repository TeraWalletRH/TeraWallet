import { Router, type Request, type Response } from "express";
import { encodeFunctionData, keccak256, stringToBytes } from "viem";
import pool from "../db";
import { SessionManagerAbi, TerraAccountAbi, getDeployments } from "../chain/metadata";
import { env } from "../env";
import { logger } from "../logging";

const router = Router();

// In-memory fallback
const memorySessions: Array<{
  id: string;
  accountAddress: string;
  sessionKeyAddress: string;
  scope: Record<string, unknown>;
  isRevoked: boolean;
  expiresAt: string;
  createdAt: string;
}> = [];

/**
 * POST /api/session/prepare-register
 * Generates the prepared transaction for the owner wallet to register a session key on-chain.
 */
router.post("/api/session/prepare-register", async (req: Request, res: Response) => {
  try {
    const {
      accountAddress,
      sessionKeyAddress,
      validAfter = 0,
      validUntil,
      dailyLimitUsdCents = 100000, // $1000 daily
      allowedTargets = [],
      allowedSelectors = [],
    } = req.body;

    if (!accountAddress || !sessionKeyAddress || !validUntil) {
      res.status(400).json({
        success: false,
        error: "accountAddress, sessionKeyAddress, and validUntil are required",
      });
      return;
    }

    const deployments = getDeployments(env.rhcChainId);

    // Encode registerSession call on SessionManager
    const registerData = encodeFunctionData({
      abi: SessionManagerAbi,
      functionName: "registerSession",
      args: [
        sessionKeyAddress,
        Number(validAfter),
        Number(validUntil),
        BigInt(dailyLimitUsdCents),
        allowedTargets,
        allowedSelectors,
      ],
    });

    // Outer call via TerraAccount.execute(sessionManager, 0, registerData)
    const txData = encodeFunctionData({
      abi: TerraAccountAbi,
      functionName: "execute",
      args: [deployments.sessionManager, 0n, registerData],
    });

    res.status(200).json({
      success: true,
      preparedTransaction: {
        to: accountAddress,
        data: txData,
        value: "0x0",
        chainId: env.rhcChainId,
      },
      scope: {
        sessionKeyAddress,
        validAfter,
        validUntil,
        dailyLimitUsdCents,
        allowedTargets,
        allowedSelectors,
      },
    });
  } catch (error) {
    logger.error(req, "session.prepare_register_failed", error);
    res.status(500).json({
      success: false,
      error: "Internal error preparing session registration",
    });
  }
});

/**
 * POST /api/session/register
 * Records a registered session key in PostgreSQL.
 */
router.post("/api/session/register", async (req: Request, res: Response) => {
  try {
    const { accountAddress, sessionKeyAddress, scope, expiresAt } = req.body;

    if (!accountAddress || !sessionKeyAddress || !expiresAt) {
      res.status(400).json({
        success: false,
        error: "accountAddress, sessionKeyAddress, and expiresAt are required",
      });
      return;
    }

    const expiryDate = new Date(expiresAt);

    try {
      if (pool) {
        // Upsert account if it doesn't exist yet
        await pool.query(
          `INSERT INTO accounts (owner_address, account_address, chain_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (account_address) DO NOTHING`,
          [accountAddress, accountAddress, env.rhcChainId]
        );

        const result = await pool.query(
          `INSERT INTO session_keys (account_address, session_key_address, scope, expires_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id, account_address, session_key_address, scope, is_revoked, expires_at, created_at`,
          [accountAddress, sessionKeyAddress, JSON.stringify(scope ?? {}), expiryDate]
        );

        res.status(201).json({
          success: true,
          session: result.rows[0],
        });
        return;
      }
    } catch (dbErr) {
      logger.warn(req, "session.persistence_fallback", dbErr);
    }

    const sessionObj = {
      id: keccak256(stringToBytes(`${accountAddress}-${sessionKeyAddress}-${Date.now()}`)).slice(0, 18),
      accountAddress,
      sessionKeyAddress,
      scope: scope ?? {},
      isRevoked: false,
      expiresAt: expiryDate.toISOString(),
      createdAt: new Date().toISOString(),
    };
    memorySessions.push(sessionObj);

    res.status(201).json({
      success: true,
      session: sessionObj,
    });
  } catch (error) {
    logger.error(req, "session.register_failed", error);
    res.status(500).json({ success: false, error: "Failed to record session" });
  }
});

/**
 * GET /api/session/:accountAddress
 * Lists active and revoked session keys for an account.
 */
router.get("/api/session/:accountAddress", async (req: Request, res: Response) => {
  const accountAddress = String(req.params.accountAddress);

  try {
    if (pool) {
      const result = await pool.query(
        `SELECT id, account_address, session_key_address, scope, is_revoked, expires_at, created_at
         FROM session_keys
         WHERE account_address = $1
         ORDER BY created_at DESC`,
        [accountAddress]
      );

      res.status(200).json({
        success: true,
        count: result.rows.length,
        sessions: result.rows,
      });
      return;
    }
  } catch (dbErr) {
      logger.warn(req, "session.query_fallback", dbErr);
  }

  const matches = memorySessions.filter(
    (s) => s.accountAddress.toLowerCase() === accountAddress.toLowerCase()
  );

  res.status(200).json({
    success: true,
    count: matches.length,
    sessions: matches,
  });
});

/**
 * POST /api/session/prepare-revoke
 * Generates the prepared transaction for the owner wallet to revoke a session key on-chain.
 */
router.post("/api/session/prepare-revoke", async (req: Request, res: Response) => {
  try {
    const { accountAddress, sessionKeyAddress } = req.body;

    if (!accountAddress || !sessionKeyAddress) {
      res.status(400).json({
        success: false,
        error: "accountAddress and sessionKeyAddress are required",
      });
      return;
    }

    const deployments = getDeployments(env.rhcChainId);

    // Encode revokeSession call on SessionManager
    const revokeData = encodeFunctionData({
      abi: SessionManagerAbi,
      functionName: "revokeSession",
      args: [sessionKeyAddress],
    });

    // Outer call via TerraAccount.execute(sessionManager, 0, revokeData)
    const txData = encodeFunctionData({
      abi: TerraAccountAbi,
      functionName: "execute",
      args: [deployments.sessionManager, 0n, revokeData],
    });

    res.status(200).json({
      success: true,
      preparedTransaction: {
        to: accountAddress,
        data: txData,
        value: "0x0",
        chainId: env.rhcChainId,
      },
    });
  } catch (error) {
    logger.error(req, "session.prepare_revoke_failed", error);
    res.status(500).json({
      success: false,
      error: "Internal error preparing session revocation",
    });
  }
});

/**
 * POST /api/session/revoke
 * Updates DB record to mark the session key as revoked.
 */
router.post("/api/session/revoke", async (req: Request, res: Response) => {
  try {
    const { accountAddress, sessionKeyAddress } = req.body;

    if (!accountAddress || !sessionKeyAddress) {
      res.status(400).json({
        success: false,
        error: "accountAddress and sessionKeyAddress are required",
      });
      return;
    }

    try {
      if (pool) {
        await pool.query(
          `UPDATE session_keys
           SET is_revoked = TRUE
           WHERE account_address = $1 AND session_key_address = $2`,
          [accountAddress, sessionKeyAddress]
        );
      }
    } catch (dbErr) {
      logger.warn(req, "session.revoke_persistence_fallback", dbErr);
    }

    const found = memorySessions.find(
      (s) =>
        s.accountAddress.toLowerCase() === accountAddress.toLowerCase() &&
        s.sessionKeyAddress.toLowerCase() === sessionKeyAddress.toLowerCase()
    );
    if (found) {
      found.isRevoked = true;
    }

    res.status(200).json({
      success: true,
      accountAddress,
      sessionKeyAddress,
      isRevoked: true,
    });
  } catch (error) {
    logger.error(req, "session.revoke_failed", error);
    res.status(500).json({ success: false, error: "Failed to revoke session in DB" });
  }
});

export default router;
