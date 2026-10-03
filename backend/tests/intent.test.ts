import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";
import { env } from "../src/env";
import { savePreparedIntent } from "../src/routes/intent";

describe("Intent Pipeline & Prepared Transaction API", () => {
  const sampleOwner = "0x1111111111111111111111111111111111111111" as const;
  const sampleAsset = "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" as const; // SpaceX (SPCX)
  const liveSwapTest = process.env.RUN_LIVE_SWAP_TESTS === "true" ? it : it.skip;

  // This depends on live RPC access and pool liquidity, so it runs only in an
  // explicitly configured integration environment, never normal CI.
  liveSwapTest("successfully prepares a valid BUY transaction passing all 5 gates", async () => {
    const payload = {
      ownerAddress: sampleOwner,
      actionType: "BUY",
      assetAddress: sampleAsset,
      amount: "1000000000000000000", // 1 token
      maxSpendUsdCents: 50000, // $500
    };

    const res = await request(app).post("/api/intent/prepare").send(payload);

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

  it("rejects a receipt for an unknown prepared intent", async () => {
    const res = await request(app).post("/api/intent/receipt").send({
      actionHash: `0x${"12".repeat(32)}`,
      txHash: `0x${"ab".repeat(32)}`,
    });
    expect(res.status).toBe(404);
  });

  it("records only the exact mined owner transaction and handles retries", async () => {
    const actionHash = `0x${"34".repeat(32)}` as const;
    const txHash = `0x${"ab".repeat(32)}` as const;
    const blockHash = `0x${"cd".repeat(32)}` as const;
    const recipient = "0x2222222222222222222222222222222222222222" as const;
    const intent = {
      ownerAddress: sampleOwner,
      assetAddress: sampleAsset,
      actionType: "TRANSFER" as const,
      amount: "5",
      recipient,
    };
    const prepared = {
      to: recipient, data: "0x" as const, value: "0x5", chainId: env.rhcChainId,
      actionHash, intent, gates: [],
    };
    const intentId = await savePreparedIntent(intent, sampleOwner, prepared, []);
    let onChainInput = "0x1234";
    let onChainFrom: string = sampleOwner;
    let onChainValue = "0x5";
    let onChainChainId = `0x${env.rhcChainId.toString(16)}`;
    let minedStatus = "0x1";
    let minedTime = Math.floor(Date.now() / 1000) + 5;
    const transaction = () => ({
      hash: txHash, blockHash, blockNumber: "0x1", chainId: onChainChainId,
      from: onChainFrom, to: recipient, input: onChainInput, value: onChainValue,
      gas: "0x5208", gasPrice: "0x1", nonce: "0x0", transactionIndex: "0x0",
      type: "0x0", v: "0x25", r: `0x${"01".repeat(32)}`, s: `0x${"02".repeat(32)}`,
    });
    const chainReceipt = () => ({
      transactionHash: txHash, blockHash, blockNumber: "0x1", from: onChainFrom, to: recipient,
      status: minedStatus, cumulativeGasUsed: "0x5208", gasUsed: "0x5208",
      effectiveGasPrice: "0x1", logs: [], logsBloom: `0x${"00".repeat(256)}`,
      transactionIndex: "0x0", type: "0x0",
    });
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const call = await request.json() as { id: number; method: string };
        const result = call.method === "eth_chainId" ? `0x${env.rhcChainId.toString(16)}`
          : call.method === "eth_getTransactionByHash" ? transaction()
          : call.method === "eth_getTransactionReceipt" ? chainReceipt()
          : call.method === "eth_getBlockByHash" ? { hash: blockHash, timestamp: `0x${minedTime.toString(16)}` }
          : null;
        return Response.json({ jsonrpc: "2.0", id: call.id, result });
      },
    });
    const previousRpc = process.env.RHC_RPC_URL;
    process.env.RHC_RPC_URL = `http://127.0.0.1:${server.port}`;
    try {
      const wrongId = await request(app).post("/api/intent/receipt")
        .send({ actionHash, txHash, intentId: "another-intent" });
      expect(wrongId.status).toBe(422);

      const forgedCall = await request(app).post("/api/intent/receipt")
        .send({ actionHash, txHash });
      expect(forgedCall.status).toBe(422);

      onChainInput = "0x";
      onChainFrom = recipient;
      expect((await request(app).post("/api/intent/receipt").send({ actionHash, txHash })).status).toBe(422);
      onChainFrom = sampleOwner;
      onChainValue = "0x6";
      expect((await request(app).post("/api/intent/receipt").send({ actionHash, txHash })).status).toBe(422);
      onChainValue = "0x5";
      onChainChainId = "0x1";
      expect((await request(app).post("/api/intent/receipt").send({ actionHash, txHash })).status).toBe(422);
      onChainChainId = `0x${env.rhcChainId.toString(16)}`;
      minedStatus = "0x0";
      expect((await request(app).post("/api/intent/receipt").send({ actionHash, txHash })).status).toBe(422);
      minedStatus = "0x1";
      minedTime -= 3600;
      expect((await request(app).post("/api/intent/receipt").send({ actionHash, txHash })).status).toBe(422);
      minedTime += 3600;
      const confirmed = await request(app).post("/api/intent/receipt")
        .send({ actionHash, txHash, recipient: sampleOwner });
      expect(confirmed.status).toBe(201);
      expect(confirmed.body.status).toBe("CONFIRMED");

      const retry = await request(app).post("/api/intent/receipt")
        .send({ actionHash, txHash });
      expect(retry.status).toBe(200);
      expect(retry.body.receiptId).toBe(confirmed.body.receiptId);

      const secondHash = `0x${"35".repeat(32)}` as const;
      await savePreparedIntent(intent, sampleOwner, { ...prepared, actionHash: secondHash }, []);
      const reusedTx = await request(app).post("/api/intent/receipt")
        .send({ actionHash: secondHash, txHash });
      expect(reusedTx.status).toBe(409);
    } finally {
      if (previousRpc === undefined) delete process.env.RHC_RPC_URL;
      else process.env.RHC_RPC_URL = previousRpc;
      server.stop(true);
    }
  });
});
