import { Router, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { encodeFunctionData, keccak256, stringToBytes } from "viem";
import pool from "../db";
import { SessionManagerAbi, TerraAccountAbi, getDeployments } from "../chain/metadata";
import { env } from "../env";
import { logEvent, logger } from "../logging";
import type { ActionType } from "../pipeline/types";

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

const SERVICE_ACTIONS: ActionType[] = ["BUY", "SELL", "TRANSFER"];
const DEFAULT_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

type ServiceScope = {
  kind: "service";
  tokenHash: string;
  allowedActions: ActionType[];
  assetAddresses: string[];
  label?: string;
  rotatedFrom?: string;
};

export class ServiceSessionAuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "ServiceSessionAuthorizationError";
  }
}

export type ServiceSessionAuthorization = {
  accountAddress: string;
  sessionKeyAddress: string;
  allowedActions: ActionType[];
  assetAddresses: string[];
  expiresAt: string;
};

const asAddress = (value: unknown) =>
  typeof value === "string" && addressPattern.test(value) ? value.toLowerCase() : null;

const withoutTokenHash = (scope: unknown) => {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return scope ?? {};
  const { tokenHash: _tokenHash, ...safeScope } = scope as Record<string, unknown>;
  return safeScope;
};

const publicSession = (session: Record<string, unknown>) => ({
  ...session,
  scope: withoutTokenHash(session.scope),
});

function validateServiceScope(body: Record<string, unknown>) {
  const actions = Array.isArray(body.allowedActions) ? body.allowedActions : [];
  const assets = Array.isArray(body.assetAddresses) ? body.assetAddresses : [];
  const allowedActions = [...new Set(actions.filter((action): action is ActionType =>
    typeof action === "string" && SERVICE_ACTIONS.includes(action as ActionType),
  ))];
  const assetAddresses = [...new Set(assets.map(asAddress).filter((value): value is string => Boolean(value)))];
  const ttlSeconds = Number(body.ttlSeconds ?? DEFAULT_TTL_SECONDS);

  if (!allowedActions.length)
    throw new Error("Choose at least one supported action: BUY, SELL, or TRANSFER.");
  if (allowedActions.length !== actions.length)
    throw new Error("Session scopes may only contain BUY, SELL, or TRANSFER.");
  if (!assetAddresses.length || assetAddresses.length !== assets.length)
    throw new Error("Choose at least one valid asset address.");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > MAX_TTL_SECONDS)
    throw new Error("ttlSeconds must be an integer between 60 seconds and 24 hours.");

  const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : undefined;
  return { allowedActions, assetAddresses, ttlSeconds, label };
}

async function storeServiceSession(
  accountAddress: string,
  scope: ServiceScope,
  expiresAt: Date,
) {
  const sessionKeyAddress = `0x${randomBytes(20).toString("hex")}`;
  try {
    if (pool) {
      await pool.query(
        `INSERT INTO accounts (owner_address, account_address, chain_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_address) DO NOTHING`,
        [accountAddress, accountAddress, env.rhcChainId],
      );
      const result = await pool.query(
        `INSERT INTO session_keys (account_address, session_key_address, scope, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, account_address, session_key_address, scope, is_revoked, expires_at, created_at`,
        [accountAddress, sessionKeyAddress, JSON.stringify(scope), expiresAt],
      );
      return result.rows[0] as Record<string, unknown>;
    }
  } catch (error) {
    logEvent("warn", undefined, "session.service_persistence_fallback", error);
  }

  const session = {
    id: keccak256(stringToBytes(`${accountAddress}-${sessionKeyAddress}-${Date.now()}`)).slice(0, 18),
    accountAddress,
    sessionKeyAddress,
    scope,
    isRevoked: false,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  };
  memorySessions.push(session);
  return session;
}

async function revokeServiceSession(accountAddress: string, sessionKeyAddress: string) {
  if (pool) {
    const result = await pool.query(
      `UPDATE session_keys
       SET is_revoked = TRUE
       WHERE account_address = $1 AND session_key_address = $2
       RETURNING id`,
      [accountAddress, sessionKeyAddress],
    );
    return (result.rowCount ?? 0) > 0;
  }
  const session = memorySessions.find(
    (candidate) =>
      candidate.accountAddress.toLowerCase() === accountAddress.toLowerCase() &&
      candidate.sessionKeyAddress.toLowerCase() === sessionKeyAddress.toLowerCase(),
  );
  if (session) session.isRevoked = true;
  return Boolean(session);
}

export async function authorizeServiceSession(
  token: string,
  actionType: ActionType,
  assetAddress: string,
): Promise<ServiceSessionAuthorization> {
  const normalizedAsset = asAddress(assetAddress);
  if (!token || !SERVICE_ACTIONS.includes(actionType) || !normalizedAsset)
    throw new ServiceSessionAuthorizationError(
      401,
      "Session token is invalid, expired, or revoked.",
    );

  const tokenHash = createHash("sha256").update(token).digest("hex");
  let session: Record<string, unknown> | undefined;
  if (pool) {
    const result = await pool.query(
      `SELECT id, account_address, session_key_address, scope, is_revoked, expires_at, created_at
       FROM session_keys
       WHERE scope ->> 'tokenHash' = $1
       LIMIT 1`,
      [tokenHash],
    );
    session = result.rows[0];
  } else {
    session = memorySessions.find((candidate) => candidate.scope.tokenHash === tokenHash);
  }
  const scope = session?.scope as ServiceScope | undefined;
  const expiresAt = String(session?.expires_at ?? session?.expiresAt ?? "");
  if (!session || !scope || scope.kind !== "service" || session.is_revoked || session.isRevoked || Date.parse(expiresAt) <= Date.now())
    throw new ServiceSessionAuthorizationError(
      401,
      "Session token is invalid, expired, or revoked.",
    );
  if (!scope.allowedActions.includes(actionType) || !scope.assetAddresses.includes(normalizedAsset))
    throw new ServiceSessionAuthorizationError(
      403,
      "Session token is outside its permitted action or asset scope.",
    );
  return {
    accountAddress: String(session.account_address ?? session.accountAddress),
    sessionKeyAddress: String(session.session_key_address ?? session.sessionKeyAddress),
    allowedActions: scope.allowedActions,
    assetAddresses: scope.assetAddresses,
    expiresAt,
  };
}

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
 * POST /api/session/issue
 * Creates an opaque, short-lived service token. The token is returned once;
 * only its SHA-256 hash is persisted with the action and asset scope.
 */
router.post("/api/session/issue", async (req: Request, res: Response) => {
  try {
    const accountAddress = asAddress(req.body.accountAddress);
    if (!accountAddress) {
      res.status(400).json({ success: false, error: "A valid accountAddress is required." });
      return;
    }
    const { allowedActions, assetAddresses, ttlSeconds, label } = validateServiceScope(req.body);
    const token = randomBytes(32).toString("base64url");
    const session = await storeServiceSession(
      accountAddress,
      {
        kind: "service",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        allowedActions,
        assetAddresses,
        ...(label ? { label } : {}),
      },
      new Date(Date.now() + ttlSeconds * 1000),
    );
    res.status(201).json({ success: true, session: publicSession(session), token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to issue session token.";
    res.status(400).json({ success: false, error: message });
  }
});

/**
 * POST /api/session/rotate
 * Immediately invalidates a service token and replaces it with the same scope.
 */
router.post("/api/session/rotate", async (req: Request, res: Response) => {
  try {
    const accountAddress = asAddress(req.body.accountAddress);
    const sessionKeyAddress = asAddress(req.body.sessionKeyAddress);
    if (!accountAddress || !sessionKeyAddress) {
      res.status(400).json({ success: false, error: "Valid accountAddress and sessionKeyAddress are required." });
      return;
    }

    let existing: Record<string, unknown> | undefined;
    if (pool) {
      const result = await pool.query(
        `SELECT id, account_address, session_key_address, scope, is_revoked, expires_at, created_at
         FROM session_keys WHERE account_address = $1 AND session_key_address = $2`,
        [accountAddress, sessionKeyAddress],
      );
      existing = result.rows[0];
    } else {
      existing = memorySessions.find(
        (session) =>
          session.accountAddress.toLowerCase() === accountAddress &&
          session.sessionKeyAddress.toLowerCase() === sessionKeyAddress,
      );
    }
    const scope = existing?.scope as ServiceScope | undefined;
    if (!existing || existing.is_revoked || existing.isRevoked || scope?.kind !== "service") {
      res.status(404).json({ success: false, error: "Active service session not found." });
      return;
    }

    const { ttlSeconds } = validateServiceScope({
      allowedActions: scope.allowedActions,
      assetAddresses: scope.assetAddresses,
      ttlSeconds: req.body.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    });
    await revokeServiceSession(accountAddress, sessionKeyAddress);
    const token = randomBytes(32).toString("base64url");
    const session = await storeServiceSession(
      accountAddress,
      {
        ...scope,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        rotatedFrom: sessionKeyAddress,
      },
      new Date(Date.now() + ttlSeconds * 1000),
    );
    res.status(201).json({ success: true, session: publicSession(session), token });
  } catch (error) {
    logger.error(req, "session.rotate_failed", error);
    res.status(500).json({ success: false, error: "Failed to rotate session token." });
  }
});

/**
 * POST /api/session/authorize
 * Checks an opaque token at request time. Revocation and expiry take effect
 * immediately because this reads the authoritative session record every time.
 */
router.post("/api/session/authorize", async (req: Request, res: Response) => {
  try {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    const actionType = req.body.actionType as ActionType;
    const assetAddress = typeof req.body.assetAddress === "string" ? req.body.assetAddress : "";
    if (!token || !SERVICE_ACTIONS.includes(actionType) || !asAddress(assetAddress)) {
      res.status(400).json({ success: false, error: "token, supported actionType, and assetAddress are required." });
      return;
    }
    const authorization = await authorizeServiceSession(token, actionType, assetAddress);
    res.status(200).json({
      success: true,
      authorization,
    });
  } catch (error) {
    if (error instanceof ServiceSessionAuthorizationError) {
      res.status(error.status).json({ success: false, error: error.message });
      return;
    }
    logger.error(req, "session.authorize_failed", error);
    res.status(500).json({ success: false, error: "Failed to authorize session token." });
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
        sessions: result.rows.map(publicSession),
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
    sessions: matches.map(publicSession),
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
