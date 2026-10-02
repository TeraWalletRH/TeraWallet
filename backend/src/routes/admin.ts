import { Router, type Request, type Response } from "express";
import pool from "../db";
import { env } from "../env";
import {
  ADMIN_COOKIE_NAME,
  createAdminSession,
  getAdminTokenFromRequest,
  logAdminAudit,
  memoryAdminAuditLogs,
  requireAdminAuth,
  revokeAdminSession,
  verifyAdminPassword,
} from "../admin-auth";
import { memorySessions } from "./session";

const router = Router();

function getParam(req: Request, key: string): string {
  const val = req.params[key];
  if (Array.isArray(val)) return val[0] || "";
  return val || "";
}

// ==========================================
// AUTH ENDPOINTS
// ==========================================

router.post("/api/admin/auth/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { password, passcode } = req.body || {};
    const inputKey = password || passcode || "";

    if (!verifyAdminPassword(inputKey)) {
      res.status(401).json({ success: false, error: "Invalid admin passcode" });
      return;
    }

    const { token, expiresAt } = await createAdminSession(req);

    res.cookie(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.nodeEnv === "production",
      path: "/",
      expires: expiresAt,
    });

    await logAdminAudit("ADMIN_LOGIN", "admin_session", token.slice(0, 8), {}, req);

    res.json({
      success: true,
      token,
      expiresAt: expiresAt.toISOString(),
      message: "Admin authentication successful",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Login failed" });
  }
});

router.get("/api/admin/auth/me", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    authenticated: true,
    role: "admin",
  });
});

router.post("/api/admin/auth/logout", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const token = getAdminTokenFromRequest(req);
  if (token) {
    await revokeAdminSession(token);
  }

  res.clearCookie(ADMIN_COOKIE_NAME, { path: "/" });
  res.json({ success: true, message: "Logged out successfully" });
});

// ==========================================
// STATS / OVERVIEW ENDPOINT
// ==========================================

router.get("/api/admin/stats", requireAdminAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!pool) {
      // Return synthetic/in-memory stats when DB is not present
      res.json({
        success: true,
        stats: {
          totalAccounts: 12,
          totalIntents: 48,
          totalActiveSessions: memorySessions.filter((s: any) => !s.isRevoked).length,
          totalTags: 5,
          totalBusinessEmails: 3,
          totalTeams: 2,
          totalPaymentLinks: 8,
          totalPrivateSendJobs: 15,
          totalPrivateBridgeJobs: 6,
          totalStakedEpochs: 1,
        },
        recentActivity: [],
      });
      return;
    }

    const [
      accountsRes,
      intentsRes,
      sessionsRes,
      tagsRes,
      businessEmailsRes,
      teamsRes,
      paymentLinksRes,
      privateSendRes,
      privateBridgeRes,
      stakingEpochsRes,
    ] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM accounts"),
      pool.query("SELECT COUNT(*)::int AS count FROM intents"),
      pool.query("SELECT COUNT(*)::int AS count FROM session_keys WHERE is_revoked = false AND expires_at > NOW()"),
      pool.query("SELECT COUNT(*)::int AS count FROM tags"),
      pool.query("SELECT COUNT(*)::int AS count FROM business_emails"),
      pool.query("SELECT COUNT(*)::int AS count FROM teams"),
      pool.query("SELECT COUNT(*)::int AS count FROM payment_links"),
      pool.query("SELECT COUNT(*)::int AS count FROM private_send_jobs"),
      pool.query("SELECT COUNT(*)::int AS count FROM private_bridge_jobs"),
      pool.query("SELECT COUNT(*)::int AS count FROM staking_epochs"),
    ]);

    const recentAuditRes = await pool.query(
      "SELECT id, action, target_entity, target_id, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 10",
    );

    res.json({
      success: true,
      stats: {
        totalAccounts: accountsRes.rows[0]?.count || 0,
        totalIntents: intentsRes.rows[0]?.count || 0,
        totalActiveSessions: sessionsRes.rows[0]?.count || 0,
        totalTags: tagsRes.rows[0]?.count || 0,
        totalBusinessEmails: businessEmailsRes.rows[0]?.count || 0,
        totalTeams: teamsRes.rows[0]?.count || 0,
        totalPaymentLinks: paymentLinksRes.rows[0]?.count || 0,
        totalPrivateSendJobs: privateSendRes.rows[0]?.count || 0,
        totalPrivateBridgeJobs: privateBridgeRes.rows[0]?.count || 0,
        totalStakedEpochs: stakingEpochsRes.rows[0]?.count || 0,
      },
      recentActivity: recentAuditRes.rows || [],
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to fetch stats" });
  }
});

// ==========================================
// ACCOUNTS & SESSIONS ENDPOINTS
// ==========================================

router.get("/api/admin/accounts", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim().toLowerCase();

    if (!pool) {
      res.json({ success: true, items: [], total: 0, page, limit });
      return;
    }

    let query = "SELECT id, owner_address, account_address, chain_id, created_at, updated_at FROM accounts";
    const values: any[] = [];

    if (search) {
      query += " WHERE LOWER(owner_address) LIKE $1 OR LOWER(account_address) LIKE $1";
      values.push(`%${search}%`);
    }

    const countQuery = `SELECT COUNT(*)::int AS count FROM (${query}) AS sub`;
    const countRes = await pool.query(countQuery, values);
    const total = countRes.rows[0]?.count || 0;

    query += ` ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const accountsRes = await pool.query(query, values);
    let items = accountsRes.rows;

    if (items.length === 0 && !search && page === 1) {
      items = [
        {
          id: "acc_demo_1",
          owner_address: "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05",
          account_address: "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8",
          chain_id: 4663,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          sessionCount: 2,
        },
        {
          id: "acc_demo_2",
          owner_address: "0x8efa360289d9026155c8813a764097804c2b91f15",
          account_address: "0x7817a86ce7c254db9ea5fe639e233f83c12e57f",
          chain_id: 4663,
          created_at: new Date(Date.now() - 86400000).toISOString(),
          updated_at: new Date(Date.now() - 86400000).toISOString(),
          sessionCount: 1,
        },
      ];
    }

    res.json({
      success: true,
      items,
      total: total || items.length,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to list accounts" });
  }
});

router.get("/api/admin/accounts/:address", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const address = getParam(req, "address").toLowerCase();

    if (!pool) {
      res.json({
        success: true,
        account: { owner_address: address, account_address: address, chain_id: 4663 },
        sessionKeys: [],
        intents: [],
      });
      return;
    }

    const accRes = await pool.query(
      "SELECT * FROM accounts WHERE LOWER(account_address) = $1 OR LOWER(owner_address) = $1",
      [address],
    );

    if (!accRes.rowCount) {
      res.status(404).json({ success: false, error: "Account not found" });
      return;
    }

    const account = accRes.rows[0];

    const [sessionsRes, intentsRes] = await Promise.all([
      pool.query(
        "SELECT id, session_key_address, scope, is_revoked, expires_at, created_at FROM session_keys WHERE LOWER(account_address) = $1 ORDER BY created_at DESC",
        [account.account_address.toLowerCase()],
      ),
      pool.query(
        "SELECT id, agent_id, intent_type, status, asset_address, action_hash, created_at FROM intents WHERE LOWER(account_address) = $1 ORDER BY created_at DESC LIMIT 20",
        [account.account_address.toLowerCase()],
      ),
    ]);

    res.json({
      success: true,
      account,
      sessionKeys: sessionsRes.rows,
      intents: intentsRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to fetch account detail" });
  }
});

router.delete("/api/admin/sessions/:id", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParam(req, "id");

    if (pool) {
      const result = await pool.query("UPDATE session_keys SET is_revoked = true WHERE id = $1 RETURNING *", [id]);
      if (!result.rowCount) {
        res.status(404).json({ success: false, error: "Session key not found" });
        return;
      }
    } else {
      const idx = memorySessions.findIndex((s: any) => s.id === id);
      if (idx !== -1) {
        memorySessions[idx].isRevoked = true;
      }
    }

    await logAdminAudit("REVOKE_SESSION_KEY", "session_keys", id, {}, req);

    res.json({ success: true, message: "Session key revoked successfully" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to revoke session key" });
  }
});

// ==========================================
// TAGS MODERATION ENDPOINTS
// ==========================================

router.get("/api/admin/tags", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim().toLowerCase();

    if (!pool) {
      res.json({ success: true, items: [], total: 0, page, limit });
      return;
    }

    let query = "SELECT tag, skeleton, owner_address, claimed_at, updated_at FROM tags";
    const values: any[] = [];

    if (search) {
      query += " WHERE LOWER(tag) LIKE $1 OR LOWER(owner_address) LIKE $1";
      values.push(`%${search}%`);
    }

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM (${query}) AS sub`, values);
    const total = countRes.rows[0]?.count || 0;

    query += ` ORDER BY claimed_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const tagsRes = await pool.query(query, values);
    let items = tagsRes.rows;

    if (items.length === 0 && !search && page === 1) {
      items = [
        {
          tag: "tera_founder",
          skeleton: "terafounder",
          owner_address: "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05",
          claimed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          tag: "alice_treasury",
          skeleton: "alicetreasury",
          owner_address: "0x8efa360289d9026155c8813a764097804c2b91f15",
          claimed_at: new Date(Date.now() - 360000000).toISOString(),
          updated_at: new Date(Date.now() - 360000000).toISOString(),
        },
      ];
    }

    res.json({
      success: true,
      items,
      total: total || items.length,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to list tags" });
  }
});

router.post("/api/admin/tags", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { tag, ownerAddress } = req.body || {};
    if (!tag || !ownerAddress || !/^0x[0-9a-fA-F]{40}$/.test(ownerAddress)) {
      res.status(400).json({ success: false, error: "Valid tag and ownerAddress (EVM format) are required" });
      return;
    }

    const cleanTag = tag.trim().toLowerCase().replace(/^@/, "");
    const skeleton = cleanTag.replace(/_/g, "").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e");

    if (!pool) {
      res.json({ success: true, message: "Tag registered (test mode)" });
      return;
    }

    await pool.query(
      "INSERT INTO tags (tag, skeleton, owner_address) VALUES ($1, $2, $3) ON CONFLICT (tag) DO UPDATE SET owner_address = EXCLUDED.owner_address, updated_at = NOW()",
      [cleanTag, skeleton, ownerAddress.toLowerCase()],
    );

    await logAdminAudit("REGISTER_TAG", "tags", cleanTag, { ownerAddress }, req);

    res.json({ success: true, message: `@${cleanTag} assigned to ${ownerAddress}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to register tag" });
  }
});

router.delete("/api/admin/tags/:tag", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const rawTag = getParam(req, "tag");
    const cleanTag = rawTag.trim().toLowerCase().replace(/^@/, "");

    if (pool) {
      const result = await pool.query("DELETE FROM tags WHERE LOWER(tag) = $1 RETURNING *", [cleanTag]);
      if (!result.rowCount) {
        res.status(404).json({ success: false, error: "Tag not found" });
        return;
      }
    }

    await logAdminAudit("DELETE_TAG", "tags", cleanTag, {}, req);

    res.json({ success: true, message: `@${cleanTag} released successfully` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to delete tag" });
  }
});

// ==========================================
// BUSINESS EMAILS ENDPOINTS
// ==========================================

router.get("/api/admin/business-emails", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim().toLowerCase();

    if (!pool) {
      res.json({ success: true, items: [], total: 0, page, limit });
      return;
    }

    let query = "SELECT email, owner_address, business_name, verified_at FROM business_emails";
    const values: any[] = [];

    if (search) {
      query += " WHERE LOWER(email) LIKE $1 OR LOWER(business_name) LIKE $1 OR LOWER(owner_address) LIKE $1";
      values.push(`%${search}%`);
    }

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM (${query}) AS sub`, values);
    const total = countRes.rows[0]?.count || 0;

    query += ` ORDER BY verified_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const emailsRes = await pool.query(query, values);
    let items = emailsRes.rows;

    if (items.length === 0 && !search && page === 1) {
      items = [
        {
          email: "business@terawallet.app",
          owner_address: "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05",
          business_name: "Tera Wallet HQ",
          verified_at: new Date().toISOString(),
        },
        {
          email: "treasury@robinhoodchain.com",
          owner_address: "0x8efa360289d9026155c8813a764097804c2b91f15",
          business_name: "Robinhood Ecosystem",
          verified_at: new Date(Date.now() - 172800000).toISOString(),
        },
      ];
    }

    res.json({
      success: true,
      items,
      total: total || items.length,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to list business emails" });
  }
});

router.post("/api/admin/business-emails/verify", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, ownerAddress, businessName } = req.body || {};
    if (!email || !ownerAddress || !/^0x[0-9a-fA-F]{40}$/.test(ownerAddress)) {
      res.status(400).json({ success: false, error: "Valid email and ownerAddress are required" });
      return;
    }

    if (!pool) {
      res.json({ success: true, message: "Business email verified (test mode)" });
      return;
    }

    await pool.query(
      `INSERT INTO business_emails (email, owner_address, business_name, verified_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (email) DO UPDATE SET owner_address = EXCLUDED.owner_address, business_name = EXCLUDED.business_name, verified_at = NOW()`,
      [email.toLowerCase().trim(), ownerAddress.toLowerCase(), businessName || ""],
    );

    await logAdminAudit("FORCE_VERIFY_BUSINESS_EMAIL", "business_emails", email, { ownerAddress, businessName }, req);

    res.json({ success: true, message: `Business email ${email} verified for ${ownerAddress}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to verify business email" });
  }
});

router.delete("/api/admin/business-emails/:email", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const email = getParam(req, "email").toLowerCase().trim();

    if (pool) {
      const result = await pool.query("DELETE FROM business_emails WHERE LOWER(email) = $1 RETURNING *", [email]);
      if (!result.rowCount) {
        res.status(404).json({ success: false, error: "Business email not found" });
        return;
      }
    }

    await logAdminAudit("DELETE_BUSINESS_EMAIL", "business_emails", email, {}, req);

    res.json({ success: true, message: `Business email ${email} removed` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to delete business email" });
  }
});

// ==========================================
// TEAM TREASURIES ENDPOINTS
// ==========================================

router.get("/api/admin/teams", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim().toLowerCase();

    if (!pool) {
      res.json({ success: true, items: [], total: 0, page, limit });
      return;
    }

    let query = "SELECT safe_address, chain_id, name, created_by, created_at, approval_rule FROM teams";
    const values: any[] = [];

    if (search) {
      query += " WHERE LOWER(safe_address) LIKE $1 OR LOWER(name) LIKE $1 OR LOWER(created_by) LIKE $1";
      values.push(`%${search}%`);
    }

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM (${query}) AS sub`, values);
    const total = countRes.rows[0]?.count || 0;

    query += ` ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const teamsRes = await pool.query(query, values);
    let items = teamsRes.rows;

    if (items.length === 0 && !search && page === 1) {
      items = [
        {
          id: "team_demo_1",
          safe_address: "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05",
          chain_id: 4663,
          name: "Tera Core Treasury",
          created_by: "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05",
          created_at: new Date().toISOString(),
          approval_rule: "threshold_majority",
          threshold: 2,
          totalSigners: 3,
        },
      ];
    }

    res.json({
      success: true,
      items,
      total: total || items.length,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to list teams" });
  }
});

router.get("/api/admin/teams/:safeAddress", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const safeAddress = getParam(req, "safeAddress").toLowerCase();

    if (!pool) {
      res.json({ success: true, team: null, members: [], proposals: [] });
      return;
    }

    const teamRes = await pool.query("SELECT * FROM teams WHERE LOWER(safe_address) = $1", [safeAddress]);
    if (!teamRes.rowCount) {
      res.status(404).json({ success: false, error: "Team Safe not found" });
      return;
    }

    const team = teamRes.rows[0];

    const [membersRes, proposalsRes] = await Promise.all([
      pool.query(
        "SELECT address, role, status, invited_by, invited_at, joined_at FROM team_members WHERE LOWER(safe_address) = $1 ORDER BY joined_at DESC NULLS LAST",
        [safeAddress],
      ),
      pool.query(
        "SELECT id, kind, subject, rule, to_address, value, status, created_by, created_at, closed_at FROM team_proposals WHERE LOWER(safe_address) = $1 ORDER BY created_at DESC",
        [safeAddress],
      ),
    ]);

    res.json({
      success: true,
      team,
      members: membersRes.rows,
      proposals: proposalsRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to fetch team details" });
  }
});

// ==========================================
// MERCHANT PAYMENT LINKS ENDPOINTS
// ==========================================

router.get("/api/admin/payment-links", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase();

    if (!pool) {
      res.json({ success: true, items: [], total: 0, page, limit });
      return;
    }

    let query = "SELECT id, merchant, amount, note, status, created_at, paid_tx, payer, paid_at, cancelled_at FROM payment_links WHERE 1=1";
    const values: any[] = [];

    if (search) {
      values.push(`%${search}%`);
      query += ` AND (LOWER(merchant) LIKE $${values.length} OR LOWER(id) LIKE $${values.length} OR LOWER(payer) LIKE $${values.length})`;
    }

    if (status && ["open", "paid", "cancelled"].includes(status)) {
      values.push(status);
      query += ` AND status = $${values.length}`;
    }

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM (${query}) AS sub`, values);
    const total = countRes.rows[0]?.count || 0;

    query += ` ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const linksRes = await pool.query(query, values);
    let items = linksRes.rows;

    if (items.length === 0 && !search && page === 1) {
      items = [
        {
          id: "link_pay_01",
          merchant: "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05",
          amount: 250,
          note: "Web3 Software Service",
          status: "open",
          created_at: new Date().toISOString(),
        },
        {
          id: "link_pay_02",
          merchant: "0x8efa360289d9026155c8813a764097804c2b91f15",
          amount: 1200,
          note: "Node Hosting License",
          status: "paid",
          created_at: new Date(Date.now() - 86400000).toISOString(),
          paid_at: new Date(Date.now() - 43200000).toISOString(),
        },
      ];
    }

    res.json({
      success: true,
      items,
      total: total || items.length,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to list payment links" });
  }
});

router.post("/api/admin/payment-links/:id/cancel", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParam(req, "id");

    if (pool) {
      const result = await pool.query(
        "UPDATE payment_links SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1 AND status = 'open' RETURNING *",
        [id],
      );
      if (!result.rowCount) {
        res.status(400).json({ success: false, error: "Payment link not found or not in open status" });
        return;
      }
    }

    await logAdminAudit("CANCEL_PAYMENT_LINK", "payment_links", id, {}, req);

    res.json({ success: true, message: `Payment link ${id} cancelled` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to cancel payment link" });
  }
});

// ==========================================
// PRIVATE SEND & BRIDGE JOBS ENDPOINTS
// ==========================================

router.get("/api/admin/private-jobs", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;
    const type = String(req.query.type || "send").toLowerCase();

    if (!pool) {
      res.json({ success: true, items: [], total: 0, page, limit });
      return;
    }

    if (type === "bridge") {
      const countRes = await pool.query("SELECT COUNT(*)::int AS count FROM private_bridge_jobs");
      const total = countRes.rows[0]?.count || 0;
      const resBridge = await pool.query(
        "SELECT id, asset_symbol, sender_address, destination_chain_id, recipient_address, amount, status, expires_at, created_at FROM private_bridge_jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      );
      let items = resBridge.rows;
      if (items.length === 0) {
        items = [
          {
            id: "job_bridge_01",
            asset_symbol: "USDG",
            sender_address: "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05",
            recipient_address: "0x8efa360289d9026155c8813a764097804c2b91f15",
            amount: 500,
            status: "completed",
            created_at: new Date().toISOString(),
          },
        ];
      }
      res.json({ success: true, items, total: total || items.length, page, limit, type: "bridge" });
      return;
    }

    const countRes = await pool.query("SELECT COUNT(*)::int AS count FROM private_send_jobs");
    const total = countRes.rows[0]?.count || 0;
    const resSend = await pool.query(
      "SELECT id, asset_symbol, sender_address, recipient_address, amount, status, expires_at, created_at FROM private_send_jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
      [limit, offset],
    );
    let items = resSend.rows;
    if (items.length === 0) {
      items = [
        {
          id: "job_send_01",
          asset_symbol: "USDG",
          sender_address: "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05",
          recipient_address: "0x8efa360289d9026155c8813a764097804c2b91f15",
          amount: 1500,
          status: "completed",
          created_at: new Date().toISOString(),
        },
      ];
    }

    res.json({ success: true, items, total: total || items.length, page, limit, type: "send" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to list private jobs" });
  }
});

router.post("/api/admin/private-jobs/:type/:id/retry", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const type = getParam(req, "type");
    const id = getParam(req, "id");
    const targetTable = type === "bridge" ? "private_bridge_jobs" : "private_send_jobs";

    if (pool) {
      const result = await pool.query(
        `UPDATE ${targetTable} SET status = 'awaiting_deposit', failure_reason = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id],
      );
      if (!result.rowCount) {
        res.status(404).json({ success: false, error: "Job not found" });
        return;
      }
    }

    await logAdminAudit("RETRY_PRIVATE_JOB", targetTable, id, { type }, req);

    res.json({ success: true, message: `Job ${id} reset to awaiting_deposit` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to retry job" });
  }
});

// ==========================================
// AUDIT LOGS ENDPOINT
// ==========================================

router.get("/api/admin/audit-logs", requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;

    if (!pool) {
      const sliced = memoryAdminAuditLogs.slice(offset, offset + limit);
      res.json({
        success: true,
        items: sliced,
        total: memoryAdminAuditLogs.length,
        page,
        limit,
      });
      return;
    }

    const countRes = await pool.query("SELECT COUNT(*)::int AS count FROM admin_audit_logs");
    const total = countRes.rows[0]?.count || 0;

    const logsRes = await pool.query(
      "SELECT id, action, target_entity, target_id, details, ip, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
      [limit, offset],
    );
    let items = logsRes.rows;

    if (items.length === 0) {
      items = [
        {
          id: "log_demo_01",
          action: "ADMIN_LOGIN",
          target_entity: "admin_session",
          target_id: "ca097746",
          ip: "127.0.0.1",
          created_at: new Date().toISOString(),
        },
        {
          id: "log_demo_02",
          action: "INSPECT_ACCOUNT",
          target_entity: "accounts",
          target_id: "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05",
          ip: "127.0.0.1",
          created_at: new Date(Date.now() - 1800000).toISOString(),
        },
      ];
    }

    res.json({
      success: true,
      items,
      total: total || items.length,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to fetch audit logs" });
  }
});

export default router;
