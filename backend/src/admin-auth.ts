import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import pool from "./db";
import { env } from "./env";

export const ADMIN_COOKIE_NAME = "tera_admin_session";

const memoryAdminSessions = new Map<string, { expiresAt: Date; createdAt: Date }>();
export const memoryAdminAuditLogs: Array<{
  id: string;
  action: string;
  targetEntity: string;
  targetId: string;
  details: Record<string, any>;
  ip: string;
  createdAt: string;
}> = [];

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getEffectiveAdminKey(): string {
  return env.masterAdminKey || process.env.MASTER_ADMIN_KEY || "TeraWallet2026Secure";
}

export function verifyAdminPassword(input: string): boolean {
  const masterKey = getEffectiveAdminKey();
  if (!input || !masterKey) return false;
  const inputBuf = Buffer.from(input);
  const keyBuf = Buffer.from(masterKey);
  if (inputBuf.length !== keyBuf.length) return false;
  return timingSafeEqual(inputBuf, keyBuf);
}

export function getAdminTokenFromRequest(req: Request): string | null {
  // Check Authorization header: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  // Check custom header: x-admin-token
  const customToken = req.headers["x-admin-token"];
  if (typeof customToken === "string" && customToken.trim()) {
    return customToken.trim();
  }

  // Check cookie
  const cookieHeader = req.headers.cookie ?? "";
  const parsedCookies = Object.fromEntries(
    cookieHeader.split(";").map((part) => {
      const [k, ...v] = part.trim().split("=");
      return [k, decodeURIComponent(v.join("="))];
    }),
  );

  return parsedCookies[ADMIN_COOKIE_NAME] || parsedCookies["tera_staking_admin"] || null;
}

export async function createAdminSession(req: Request): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const durationHours = env.teraStakingAdminSessionHours || 8;
  const expiresAt = new Date(Date.now() + durationHours * 3_600_000);
  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";
  const userAgent = req.headers["user-agent"] || "";

  if (pool) {
    await pool.query("DELETE FROM admin_sessions WHERE expires_at <= NOW()");
    await pool.query(
      "INSERT INTO admin_sessions (token_hash, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4)",
      [tokenHash, ip, userAgent, expiresAt],
    );
  } else {
    // In-memory fallback
    memoryAdminSessions.set(tokenHash, { expiresAt, createdAt: new Date() });
  }

  return { token, expiresAt };
}

export async function isValidAdminSession(token: string): Promise<boolean> {
  if (!token) return false;
  const tokenHash = hashToken(token);

  if (pool) {
    try {
      const res = await pool.query(
        "SELECT token_hash FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW()",
        [tokenHash],
      );
      if (res.rowCount && res.rowCount > 0) return true;
    } catch {
      // Fall through to memory check if DB query fails
    }
  }

  const mem = memoryAdminSessions.get(tokenHash);
  if (mem && mem.expiresAt.getTime() > Date.now()) {
    return true;
  }

  return false;
}

export async function revokeAdminSession(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = hashToken(token);

  if (pool) {
    try {
      await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [tokenHash]);
    } catch {
      // ignore error
    }
  }

  memoryAdminSessions.delete(tokenHash);
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getAdminTokenFromRequest(req);

  if (!token) {
    res.status(401).json({ success: false, error: "Admin authentication required" });
    return;
  }

  const valid = await isValidAdminSession(token);
  if (!valid) {
    res.status(401).json({ success: false, error: "Invalid or expired admin session" });
    return;
  }

  next();
}

export async function logAdminAudit(
  action: string,
  targetEntity: string,
  targetId: string,
  details: Record<string, any> = {},
  req?: Request,
): Promise<void> {
  const ip = req ? ((req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1") : "system";

  if (pool) {
    try {
      await pool.query(
        "INSERT INTO admin_audit_logs (action, target_entity, target_id, details, ip) VALUES ($1, $2, $3, $4, $5)",
        [action, targetEntity, targetId, JSON.stringify(details), ip],
      );
      return;
    } catch (err) {
      console.error("Failed to write admin audit log to DB:", err);
    }
  }

  memoryAdminAuditLogs.unshift({
    id: randomBytes(16).toString("hex"),
    action,
    targetEntity,
    targetId,
    details,
    ip,
    createdAt: new Date().toISOString(),
  });
}
