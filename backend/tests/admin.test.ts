import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

const testAdminKey = "test-admin-key-for-auth-regression";
const originalAdminKey = process.env.MASTER_ADMIN_KEY;

describe("Admin Dashboard Backend API", () => {
  beforeEach(() => {
    process.env.MASTER_ADMIN_KEY = testAdminKey;
  });

  afterEach(() => {
    if (originalAdminKey === undefined) delete process.env.MASTER_ADMIN_KEY;
    else process.env.MASTER_ADMIN_KEY = originalAdminKey;
  });

  it("denies unauthenticated requests to protected admin routes", async () => {
    const res = await request(app).get("/api/admin/stats");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Admin authentication required");
  });

  it("rejects login with invalid passcode", async () => {
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({ password: "wrong_password_123" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rejects login when the admin key is not configured", async () => {
    delete process.env.MASTER_ADMIN_KEY;
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({ password: testAdminKey });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rejects previously hardcoded passcodes", async () => {
    for (const password of ["TeraWallet2026Secure", "kasab67"]) {
      const res = await request(app)
        .post("/api/admin/auth/login")
        .send({ password });
      expect(res.status).toBe(401);
    }
  });

  it("allows login with configured admin passcode and accesses protected routes", async () => {
    const loginRes = await request(app)
      .post("/api/admin/auth/login")
      .send({ password: testAdminKey });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.token).toBeDefined();

    const token = loginRes.body.token;

    // Test /api/admin/auth/me with Bearer token
    const meRes = await request(app)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.success).toBe(true);
    expect(meRes.body.authenticated).toBe(true);

    // Test /api/admin/stats
    const statsRes = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${token}`);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.success).toBe(true);
    expect(statsRes.body.stats).toBeDefined();

    // Test /api/admin/accounts
    const accRes = await request(app)
      .get("/api/admin/accounts")
      .set("Authorization", `Bearer ${token}`);

    expect(accRes.status).toBe(200);
    expect(accRes.body.success).toBe(true);
    expect(Array.isArray(accRes.body.items)).toBe(true);

    // Test /api/admin/tags
    const tagsRes = await request(app)
      .get("/api/admin/tags")
      .set("Authorization", `Bearer ${token}`);

    expect(tagsRes.status).toBe(200);
    expect(tagsRes.body.success).toBe(true);

    // Test /api/admin/audit-logs
    const auditRes = await request(app)
      .get("/api/admin/audit-logs")
      .set("Authorization", `Bearer ${token}`);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.success).toBe(true);
  });

  it("logs out and invalidates admin token", async () => {
    const loginRes = await request(app)
      .post("/api/admin/auth/login")
      .send({ password: testAdminKey });

    const token = loginRes.body.token;

    const logoutRes = await request(app)
      .post("/api/admin/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(logoutRes.status).toBe(200);

    const meRes = await request(app)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meRes.status).toBe(401);
  });

  it("invalidates existing sessions when the configured key changes", async () => {
    const loginRes = await request(app)
      .post("/api/admin/auth/login")
      .send({ password: testAdminKey });
    expect(loginRes.status).toBe(200);

    process.env.MASTER_ADMIN_KEY = "rotated-test-admin-key";
    const meRes = await request(app)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`);
    expect(meRes.status).toBe(401);
  });
});
