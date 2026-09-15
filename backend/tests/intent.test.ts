import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";
import { env } from "../src/env";

describe("Intent Pipeline & Prepared Transaction API", () => {
  const sampleOwner = "0x1111111111111111111111111111111111111111" as const;
  const sampleAsset = "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" as const; // SpaceX (SPCX)


  it("successfully prepares a valid BUY transaction passing all 5 gates", async () => {
    const payload = {
      ownerAddress: sampleOwner,
      actionType: "BUY",
      assetAddress: sampleAsset,
      amount: "1000000000000000000", // 1 token
      maxSpendUsdCents: 50000, // $500
    };

    const res = await request(app).post("/api/intent/prepare").send(payload);

    // Live swap preparation depends on current chain liquidity and RPC access.
    // CI may reach the RPC but still have no usable route for this fixture.
    if (res.status !== 200) {
      expect([422, 503]).toContain(res.status);
      expect(res.body.quoteUnavailable).toBe(true);
      return;
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.gates.length).toBe(5);
    expect(res.body.gates.every((g: { passed: boolean }) => g.passed)).toBe(true);

    const tx = res.body.preparedTransaction;
    expect(tx.to).toBeDefined();
    expect(tx.data).toStartWith("0x");
    expect(tx.actionHash).toStartWith("0x");
    expect(tx.chainId).toBe(env.rhcChainId);
  });

  it("returns 501 for CLAIM_YIELD (unsupported action — no yield protocol configured)", async () => {
    const payload = {
      ownerAddress: sampleOwner,
      actionType: "CLAIM_YIELD",
      assetAddress: sampleAsset,
      amount: "1",
    };

    const res = await request(app).post("/api/intent/prepare").send(payload);

    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.supported).toBe(false);
    expect(res.body.action).toBe("CLAIM_YIELD");
  });

  it("rejects intent exceeding policy spending limits with 422 status", async () => {
    const payload = {
      ownerAddress: sampleOwner,
      actionType: "BUY",
      assetAddress: sampleAsset,
      amount: "1000000000000000000",
      maxSpendUsdCents: 50_000_000, // $500,000 > $10,000 limit
    };

    const res = await request(app).post("/api/intent/prepare").send(payload);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("exceeds the maximum single-trade limit");
  });

  it("rejects intent with zero amount at the risk engine gate with 422 status", async () => {
    const payload = {
      ownerAddress: sampleOwner,
      actionType: "BUY",
      assetAddress: sampleAsset,
      amount: "0",
    };

    const res = await request(app).post("/api/intent/prepare").send(payload);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("greater than zero");
  });

  it("returns 400 if required fields are missing", async () => {
    const res = await request(app).post("/api/intent/prepare").send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("records a transaction receipt successfully", async () => {
    const receiptPayload = {
      actionHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      recipient: sampleOwner,
    };

    const res = await request(app).post("/api/intent/receipt").send(receiptPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("CONFIRMED");
    expect(res.body.receiptId).toBeDefined();
  });
});
