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
    expect(res.body.preparedTransaction.quote.comparedRoutes.length).toBeGreaterThan(0);
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

  it("does not invent an asset or amount for an unclear proposal", async () => {
    const res = await request(app).post("/api/agent/propose").send({
      prompt: "Buy something for me",
      ownerAddress: sampleOwner,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Specify an action, supported asset, and exact amount.");
  });

  it("does not treat a chain ID or two different numbers as the spend amount", async () => {
    for (const prompt of ["Buy SpaceX on Chain 4663", "Buy 2 SpaceX for $100"]) {
      const res = await request(app).post("/api/agent/propose").send({ prompt, ownerAddress: sampleOwner });
      expect(res.status).toBe(422);
    }
  });

  it("parses multi-recipient transfer prompt into an atomic Multicall3 batch transaction", async () => {
    const recipient1 = "0x1111111111111111111111111111111111111111";
    const recipient2 = "0x2222222222222222222222222222222222222222";
    const res = await request(app).post("/api/agent/propose").send({
      prompt: `Send 50 USDG to ${recipient1} and 75 USDG to ${recipient2}`,
      ownerAddress: sampleOwner,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.intent.actionType).toBe("TRANSFER");
    expect(res.body.intent.transfers).toBeDefined();
    expect(res.body.intent.transfers.length).toBe(2);
    expect(res.body.intent.transfers[0].recipient).toBe(recipient1);
    expect(res.body.intent.transfers[0].amount).toBe("50000000");
    expect(res.body.intent.transfers[1].recipient).toBe(recipient2);
    expect(res.body.intent.transfers[1].amount).toBe("75000000");
    expect(res.body.intent.amount).toBe("125000000");
    expect(res.body.explanation).toContain("batch transfer");
    expect(res.body.explanation).toContain("125 USDG");
    expect(res.body.preparedTransaction.to.toLowerCase()).toBe("0xca11bde05977b3631167028862be2a173976ca11");
    expect(res.body.preparedTransaction.batchDetails).toBeDefined();
    expect(res.body.preparedTransaction.batchDetails.totalRecipients).toBe(2);
  }, 15000);

  it("resolves @tags in batch transfers", async () => {
    const res = await request(app).post("/api/agent/propose").send({
      prompt: "Send 20 USDG to @alice and 30 USDG to @bob",
      ownerAddress: sampleOwner,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.intent.transfers.length).toBe(2);
    expect(res.body.intent.transfers[0].tag).toBe("@alice");
    expect(res.body.intent.transfers[0].recipient).toBe("0x1111111111111111111111111111111111111111");
    expect(res.body.intent.transfers[1].tag).toBe("@bob");
    expect(res.body.intent.transfers[1].recipient).toBe("0x2222222222222222222222222222222222222222");
    expect(res.body.intent.amount).toBe("50000000");
  }, 15000);

  it("handles multi-recipient native ETH batch transfers", async () => {
    const res = await request(app).post("/api/agent/propose").send({
      prompt: "Send 1 ETH to @alice and 2 ETH to @bob",
      ownerAddress: sampleOwner,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.intent.transfers.length).toBe(2);
    expect(res.body.preparedTransaction.to.toLowerCase()).toBe("0xca11bde05977b3631167028862be2a173976ca11");
    expect(res.body.preparedTransaction.value).toBe("0x29a2241af62c0000"); // 3 ETH in hex
  }, 15000);

  it("rejects batch transfer when a tag cannot be resolved", async () => {
    const res = await request(app).post("/api/agent/propose").send({
      prompt: "Send 10 USDG to @unknownunregisteredtag and 20 USDG to @bob",
      ownerAddress: sampleOwner,
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("Could not resolve tag");
  });
});
