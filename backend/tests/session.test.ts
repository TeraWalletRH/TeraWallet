import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

describe("Session Keys Management API", () => {
  const accountAddress = "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199";
  const sessionKeyAddress = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

  it("POST /api/session/prepare-register builds valid registration calldata", async () => {
    const res = await request(app).post("/api/session/prepare-register").send({
      accountAddress,
      sessionKeyAddress,
      validUntil: Math.floor(Date.now() / 1000) + 86400,
      dailyLimitUsdCents: 50000,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.preparedTransaction.to).toBe(accountAddress);
    expect(res.body.preparedTransaction.data).toStartWith("0x");
  });

  it("POST /api/session/register records session key in DB", async () => {
    const res = await request(app).post("/api/session/register").send({
      accountAddress,
      sessionKeyAddress,
      scope: { dailyLimitUsdCents: 50000, allowedTargets: [] },
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.session.session_key_address || res.body.session.sessionKeyAddress).toBe(sessionKeyAddress);
  });

  it("GET /api/session/:accountAddress lists registered sessions", async () => {
    const res = await request(app).get(`/api/session/${accountAddress}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/session/prepare-revoke and /revoke marks session revoked", async () => {
    const prepRes = await request(app).post("/api/session/prepare-revoke").send({
      accountAddress,
      sessionKeyAddress,
    });
    expect(prepRes.status).toBe(200);
    expect(prepRes.body.preparedTransaction.data).toStartWith("0x");

    const revRes = await request(app).post("/api/session/revoke").send({
      accountAddress,
      sessionKeyAddress,
    });
    expect(revRes.status).toBe(200);
    expect(revRes.body.isRevoked).toBe(true);
  });

  it("issues a short-lived token scoped to one action and asset", async () => {
    const issued = await request(app).post("/api/session/issue").send({
      accountAddress,
      allowedActions: ["BUY"],
      assetAddresses: ["0x1111111111111111111111111111111111111111"],
      ttlSeconds: 900,
      label: "assistant",
    });

    expect(issued.status).toBe(201);
    expect(issued.body.token).toBeString();
    expect(issued.body.session.scope.tokenHash).toBeUndefined();
    expect(issued.body.session.scope.allowedActions).toEqual(["BUY"]);

    const allowed = await request(app).post("/api/session/authorize").send({
      token: issued.body.token,
      actionType: "BUY",
      assetAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.success).toBe(true);

    const blocked = await request(app).post("/api/session/authorize").send({
      token: issued.body.token,
      actionType: "SELL",
      assetAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(blocked.status).toBe(403);
  });

  it("rotates and immediately revokes service tokens", async () => {
    const issued = await request(app).post("/api/session/issue").send({
      accountAddress,
      allowedActions: ["TRANSFER"],
      assetAddresses: ["0x2222222222222222222222222222222222222222"],
    });
    const oldKey = issued.body.session.sessionKeyAddress;
    const rotated = await request(app).post("/api/session/rotate").send({
      accountAddress,
      sessionKeyAddress: oldKey,
      ttlSeconds: 3600,
    });
    expect(rotated.status).toBe(201);

    const oldToken = await request(app).post("/api/session/authorize").send({
      token: issued.body.token,
      actionType: "TRANSFER",
      assetAddress: "0x2222222222222222222222222222222222222222",
    });
    expect(oldToken.status).toBe(401);

    const newToken = await request(app).post("/api/session/authorize").send({
      token: rotated.body.token,
      actionType: "TRANSFER",
      assetAddress: "0x2222222222222222222222222222222222222222",
    });
    expect(newToken.status).toBe(200);

    const revoked = await request(app).post("/api/session/revoke").send({
      accountAddress,
      sessionKeyAddress: rotated.body.session.sessionKeyAddress,
    });
    expect(revoked.status).toBe(200);

    const revokedToken = await request(app).post("/api/session/authorize").send({
      token: rotated.body.token,
      actionType: "TRANSFER",
      assetAddress: "0x2222222222222222222222222222222222222222",
    });
    expect(revokedToken.status).toBe(401);
  });
});
