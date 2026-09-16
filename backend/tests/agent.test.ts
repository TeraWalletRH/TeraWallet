import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

describe("AI Agent Proposal Layer", () => {
  const sampleOwner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  it("POST /api/agent/propose parses prompt into structured intent and returns prepared tx", async () => {
    const res = await request(app).post("/api/agent/propose").send({
      prompt: "I want to invest $250 into SpaceX stock on Robinhood Chain",
      ownerAddress: sampleOwner,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.explanation).toBeString();
    expect(res.body.intent).toBeDefined();
    expect(res.body.intent.actionType).toBe("BUY");
    expect(res.body.gates.length).toBe(5);
    expect(res.body.preparedTransaction).toBeDefined();
    expect(res.body.preparedTransaction.to).toBeDefined();
    expect(res.body.preparedTransaction.data).toStartWith("0x");
  }, 15000);

  it("POST /api/agent/chat answers questions about RWA compliance", async () => {
    const res = await request(app).post("/api/agent/chat").send({
      message: "Explain how Tera Wallet protects my assets on Robinhood Chain when an AI agent proposes a trade.",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reply).toBeString();
    expect(res.body.reply.length).toBeGreaterThan(20);
  }, 15000);

  it("rejects proposal payloads that include unnecessary profile or portfolio data", async () => {
    const res = await request(app).post("/api/agent/propose").send({
      prompt: "Buy $10 of SpaceX",
      ownerAddress: sampleOwner,
      portfolio: { positions: [] },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Proposal payload only accepts prompt, ownerAddress, and an optional sessionToken");
    expect(res.body.unsupportedFields).toEqual(["portfolio"]);
  });

  it("enforces a connected session token before preparing an agent proposal", async () => {
    const issued = await request(app).post("/api/session/issue").send({
      accountAddress: sampleOwner,
      allowedActions: ["TRANSFER"],
      assetAddresses: ["0x1111111111111111111111111111111111111111"],
      ttlSeconds: 900,
    });
    expect(issued.status).toBe(201);

    const res = await request(app).post("/api/agent/propose").send({
      prompt: "Buy $10 of SpaceX",
      ownerAddress: sampleOwner,
      sessionToken: issued.body.token,
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Session token is outside its permitted action or asset scope.");
  }, 15000);

  it("binds a transfer proposal to the recipient supplied in the request", async () => {
    const recipient = "0xB988903293BC6F0F0AF79c6D2dc9A978c9Fc9d02";
    const res = await request(app).post("/api/agent/propose").send({
      prompt: `Send 10 USDG to ${recipient}`,
      ownerAddress: sampleOwner,
    });

    expect(res.status).toBe(200);
    expect(res.body.intent.actionType).toBe("TRANSFER");
    expect(res.body.intent.recipient).toBe(recipient);
    expect(res.body.preparedTransaction.data.toLowerCase()).toContain(recipient.slice(2).toLowerCase());
  }, 15000);

  it("rejects a transfer request without a valid recipient", async () => {
    const res = await request(app).post("/api/agent/propose").send({
      prompt: "Send 10 USDG",
      ownerAddress: sampleOwner,
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Transfers require a valid recipient address in the request.");
  }, 15000);
});
