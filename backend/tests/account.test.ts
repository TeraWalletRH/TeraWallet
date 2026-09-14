import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

describe("Account & History API", () => {
  const ownerAddress = "0xcd3B766CCDd6AE721141F452C550Ca635964ce71";
  const accountAddress = "0x2546BcD3c84621e976D8185a91A922aE77ECEc30";

  it("POST /api/account/register registers an account", async () => {
    const res = await request(app).post("/api/account/register").send({
      ownerAddress,
      accountAddress,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.account.account_address || res.body.account.accountAddress).toBe(accountAddress);
  });

  it("GET /api/account/:address fetches account summary with stats", async () => {
    const res = await request(app).get(`/api/account/${accountAddress}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stats).toBeDefined();
  });

  it("GET /api/account/:address/history returns intent audit history", async () => {
    const res = await request(app).get(`/api/account/${accountAddress}/history`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.history).toBeArray();
  });
});
