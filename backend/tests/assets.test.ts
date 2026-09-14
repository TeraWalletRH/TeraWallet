import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

describe("Asset Registry & Preflight API", () => {
  it("GET /api/assets returns list of approved RWA assets", async () => {
    const res = await request(app).get("/api/assets");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(5);
    expect(res.body.assets).toBeArray();

    const usyc = res.body.assets.find((a: { symbol: string }) => a.symbol === "USYC");
    expect(usyc).toBeDefined();
    expect(usyc.tokenStandard).toBe("ERC-3643");
    expect(usyc.yieldApyPercent).toBeGreaterThan(0);
  });

  it("GET /api/assets/:query finds asset by symbol or address", async () => {
    const res = await request(app).get("/api/assets/USYC");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.asset.symbol).toBe("USYC");

    const notFound = await request(app).get("/api/assets/NONEXISTENT");
    expect(notFound.status).toBe(404);
    expect(notFound.body.success).toBe(false);
  });

  it("POST /api/assets/preflight evaluates ERC-3643 transfer preflight", async () => {
    const res = await request(app).post("/api/assets/preflight").send({
      assetAddress: "0x1111111111111111111111111111111111111111",
      walletAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      amount: "500000000",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.canTransfer).toBe(true);
  });
});
