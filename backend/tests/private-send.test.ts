import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";
import { USDG, REAL_ROBINHOOD_RWA_ASSETS } from "../src/data/assets";

describe("Private Send API - Update 2 (USDG & RWAs)", () => {
  const validSender = "0x1111111111111111111111111111111111111111";
  const validRecipient = "0x2222222222222222222222222222222222222222";

  it("GET /api/private-send/config includes USDG and RWAs in supported assets", async () => {
    const res = await request(app).get("/api/private-send/config");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const symbols = res.body.assets.map((a: { symbol: string }) => a.symbol);
    expect(symbols).toContain("ETH");
    expect(symbols).toContain("TERA");
    expect(symbols).toContain("USDG");
    expect(symbols).toContain("SPCX");
    expect(symbols).toContain("AAPL");

    const usdg = res.body.assets.find((a: { symbol: string }) => a.symbol === "USDG");
    expect(usdg.decimals).toBe(6);
  });

  it("POST /api/private-send/jobs prepares a USDG job with 6 decimals and ERC-20 transfer calldata", async () => {
    const res = await request(app)
      .post("/api/private-send/jobs")
      .send({
        asset: "USDG",
        amount: "5000000", // 5 USDG (6 decimals)
        senderAddress: validSender,
        recipientAddress: validRecipient,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.job.asset_symbol).toBe("USDG");
    expect(res.body.job.decimals).toBe(6);
    expect(res.body.job.amount).toBe("5000000");
    expect(res.body.job.asset_address.toLowerCase()).toBe(USDG.address.toLowerCase());
    expect(res.body.preparedDeposit.to.toLowerCase()).toBe(USDG.address.toLowerCase());
    expect(res.body.preparedDeposit.value).toBe("0x0");
    expect(res.body.preparedDeposit.data.startsWith("0xa9059cbb")).toBe(true); // ERC-20 transfer(address,uint256)
  });

  it("POST /api/private-send/jobs prepares an RWA (SPCX) job with 18 decimals and ERC-20 transfer calldata", async () => {
    const spcx = REAL_ROBINHOOD_RWA_ASSETS.find((a) => a.symbol === "SPCX")!;
    const res = await request(app)
      .post("/api/private-send/jobs")
      .send({
        asset: "SPCX",
        amount: "1000000000000000000", // 1 SPCX (18 decimals)
        senderAddress: validSender,
        recipientAddress: validRecipient,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.job.asset_symbol).toBe("SPCX");
    expect(res.body.job.decimals).toBe(18);
    expect(res.body.job.amount).toBe("1000000000000000000");
    expect(res.body.job.asset_address.toLowerCase()).toBe(spcx.address.toLowerCase());
    expect(res.body.preparedDeposit.to.toLowerCase()).toBe(spcx.address.toLowerCase());
    expect(res.body.preparedDeposit.value).toBe("0x0");
    expect(res.body.preparedDeposit.data.startsWith("0xa9059cbb")).toBe(true);
  });

  it("POST /api/private-send/jobs rejects unsupported tokens", async () => {
    const res = await request(app)
      .post("/api/private-send/jobs")
      .send({
        asset: "UNKNOWN_TOKEN",
        amount: "1000000",
        senderAddress: validSender,
        recipientAddress: validRecipient,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("not supported or active");
  });

  it("POST /api/private-send/jobs rejects invalid recipient addresses", async () => {
    const res = await request(app)
      .post("/api/private-send/jobs")
      .send({
        asset: "USDG",
        amount: "1000000",
        senderAddress: validSender,
        recipientAddress: "not-an-address",
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it("POST /api/private-send/jobs rejects non-positive amounts", async () => {
    const res = await request(app)
      .post("/api/private-send/jobs")
      .send({
        asset: "USDG",
        amount: "0",
        senderAddress: validSender,
        recipientAddress: validRecipient,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });
});
