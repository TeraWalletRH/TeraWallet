import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

describe("Privacy Audit & Retention API", () => {
  it("GET /api/privacy/audit returns machine-readable data categories, retention periods, processors, and deletion status", async () => {
    const res = await request(app).get("/api/privacy/audit");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.version).toBe("1.0.0");
    expect(typeof res.body.generatedAt).toBe("string");

    // Data categories
    expect(Array.isArray(res.body.dataCategories)).toBe(true);
    expect(res.body.dataCategories.length).toBeGreaterThanOrEqual(4);
    for (const cat of res.body.dataCategories) {
      expect(typeof cat.category).toBe("string");
      expect(Array.isArray(cat.fields)).toBe(true);
      expect(typeof cat.purpose).toBe("string");
      expect(typeof cat.identifying).toBe("boolean");
      expect(typeof cat.retention).toBe("string");
    }

    // Retention periods
    expect(typeof res.body.retentionPeriods).toBe("object");
    expect(typeof res.body.retentionPeriods.unconfirmedProposals).toBe("string");
    expect(typeof res.body.retentionPeriods.assistantChatPrompts).toBe("string");
    expect(typeof res.body.retentionPeriods.sessionDelegationTokens).toBe("string");

    // Processors
    expect(Array.isArray(res.body.processors)).toBe(true);
    expect(res.body.processors.length).toBeGreaterThanOrEqual(3);
    for (const proc of res.body.processors) {
      expect(typeof proc.name).toBe("string");
      expect(typeof proc.role).toBe("string");
      expect(Array.isArray(proc.dataReceived)).toBe(true);
    }

    // Deletion policy
    expect(res.body.deletionPolicy.supported).toBe(true);
    expect(res.body.deletionPolicy.endpoint).toBe("DELETE /api/account/:address/assistant-data");
    expect(typeof res.body.deletionPolicy.mechanism).toBe("string");
  });

  it("GET /api/privacy/audit?account=0x... includes account-specific audit stats", async () => {
    const testWallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const res = await request(app).get(`/api/privacy/audit?account=${testWallet}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accountAudit).toBeDefined();
    expect(res.body.accountAudit.accountAddress).toBe(testWallet.toLowerCase());
    expect(typeof res.body.accountAudit.status).toBe("string");
    expect(typeof res.body.accountAudit.canPurge).toBe("boolean");
  });

  it("GET /api/account/:address/privacy-audit returns privacy record and deletion status", async () => {
    const testWallet = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const res = await request(app).get(`/api/account/${testWallet}/privacy-audit`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accountAddress).toBe(testWallet.toLowerCase());
    expect(res.body.accountAudit).toBeDefined();
    expect(res.body.deletionPolicy.supported).toBe(true);
    expect(Array.isArray(res.body.dataCategories)).toBe(true);
  });

  it("GET /api/account/:address/privacy-audit rejects invalid addresses with 400", async () => {
    const res = await request(app).get("/api/account/invalid-address/privacy-audit");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Invalid account address");
  });
});
