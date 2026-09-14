import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

describe("Asset Registry & Preflight API", () => {
  it("GET /api/assets returns list of real Robinhood RWA assets", async () => {
    const res = await request(app).get("/api/assets");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(10);
    expect(res.body.assets).toBeArray();

    const spcx = res.body.assets.find((a: { symbol: string }) => a.symbol === "SPCX");
    expect(spcx).toBeDefined();
    expect(spcx.name).toContain("SpaceX");
    expect(spcx.address.toLowerCase()).toBe("0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea");
    expect(spcx.decimals).toBe(18);

    const usdg = res.body.assets.find((a: { symbol: string }) => a.symbol === "USDG");
    expect(usdg).toBeDefined();
    expect(usdg.decimals).toBe(6);
  });

  it("GET /api/assets/:query finds asset by symbol, alias, or address", async () => {
    const resSymbol = await request(app).get("/api/assets/SPCX");
    expect(resSymbol.status).toBe(200);
    expect(resSymbol.body.success).toBe(true);
    expect(resSymbol.body.asset.symbol).toBe("SPCX");

    // Test alias resolution (e.g. SPACEX -> SPCX)
    const resAlias = await request(app).get("/api/assets/SPACEX");
    expect(resAlias.status).toBe(200);
    expect(resAlias.body.success).toBe(true);
    expect(resAlias.body.asset.symbol).toBe("SPCX");

    const notFound = await request(app).get("/api/assets/NONEXISTENT");
    expect(notFound.status).toBe(404);
    expect(notFound.body.success).toBe(false);
  });

  it("POST /api/assets/preflight evaluates transfer preflight", async () => {
    const res = await request(app).post("/api/assets/preflight").send({
      assetAddress: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
      walletAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      amount: "1000000000000000000",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.canTransfer).toBe(true);
  });
});
