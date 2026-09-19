import { describe, expect, it } from "bun:test";
import request from "supertest";
import { decodeFunctionData, erc20Abi, getAddress } from "viem";
import app from "../src/app";
import { NATIVE, USDG } from "../src/bridge";

describe("Private Bridge API - Update 3 & 4 (ETH & USDG)", () => {
  const validSender = "0x1111111111111111111111111111111111111111";
  const validBaseRecipient = "0x2222222222222222222222222222222222222222";
  const validSolanaRecipient = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Valid base58 32-byte address

  it("GET /api/bridge/private/config returns private bridge configuration with ETH and USDG", async () => {
    const res = await request(app).get("/api/bridge/private/config");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.originChainId).toBe(4663);
    expect(res.body.vaultAddress).toBeDefined();
    expect(res.body.payoutAddress).toBeDefined();
    expect(res.body.privacy).toContain("Private bridge routing");

    const ethSource = res.body.sourceAssets.find((a: any) => a.symbol === "ETH");
    expect(ethSource).toBeDefined();
    expect(ethSource.native).toBe(true);
    expect(ethSource.currency).toBe(NATIVE);
    expect(ethSource.decimals).toBe(18);

    const usdgSource = res.body.sourceAssets.find((a: any) => a.symbol === "USDG");
    expect(usdgSource).toBeDefined();
    expect(usdgSource.native).toBe(false);
    expect(usdgSource.currency.toLowerCase()).toBe(USDG.toLowerCase());
    expect(usdgSource.decimals).toBe(6);

    const destChains = res.body.destinations.map((d: any) => d.id);
    expect(destChains).toContain(8453); // Base
    expect(destChains).toContain(792703809); // Solana
    expect(destChains).toContain(5042); // Arc
  });

  it("POST /api/bridge/private/jobs prepares an ETH private bridge job to Base", async () => {
    const amount = "10000000000000000"; // 0.01 ETH
    const res = await request(app)
      .post("/api/bridge/private/jobs")
      .send({
        senderAddress: validSender,
        originCurrency: NATIVE,
        destinationChainId: 8453,
        destinationCurrency: NATIVE,
        recipient: validBaseRecipient,
        amount,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.job).toBeDefined();
    expect(res.body.job.asset_symbol).toBe("ETH");
    expect(res.body.job.decimals).toBe(18);
    expect(res.body.job.amount).toBe(amount);
    expect(res.body.job.destination_chain_id).toBe(8453);
    expect(res.body.job.recipient_address.toLowerCase()).toBe(validBaseRecipient.toLowerCase());

    // Deposit goes to vaultAddress
    expect(res.body.preparedDeposit.to.toLowerCase()).toBe(res.body.job.vault_address.toLowerCase());
    expect(res.body.preparedDeposit.data).toBe("0x");
    expect(res.body.preparedDeposit.value).toBe(`0x${BigInt(amount).toString(16)}`);
    expect(res.body.preparedDeposit.chainId).toBe(4663);
  });

  it("POST /api/bridge/private/jobs prepares a USDG private bridge job to Base USDC", async () => {
    const amount = "10000000"; // 10 USDG (6 decimals)
    const res = await request(app)
      .post("/api/bridge/private/jobs")
      .send({
        senderAddress: validSender,
        originCurrency: USDG,
        destinationChainId: 8453,
        destinationCurrency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base USDC
        recipient: validBaseRecipient,
        amount,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.job).toBeDefined();
    expect(res.body.job.asset_symbol).toBe("USDG");
    expect(res.body.job.decimals).toBe(6);
    expect(res.body.job.amount).toBe(amount);
    expect(res.body.job.destination_chain_id).toBe(8453);
    expect(res.body.job.recipient_address.toLowerCase()).toBe(validBaseRecipient.toLowerCase());

    // Prepared deposit is an ERC-20 transfer of USDG to vault_address
    expect(res.body.preparedDeposit.to.toLowerCase()).toBe(USDG.toLowerCase());
    expect(res.body.preparedDeposit.value).toBe("0x0");
    expect(res.body.preparedDeposit.chainId).toBe(4663);

    // Decode and verify the transfer calldata
    const decoded = decodeFunctionData({
      abi: erc20Abi,
      data: res.body.preparedDeposit.data,
    });
    expect(decoded.functionName).toBe("transfer");
    expect(getAddress((decoded.args as any)[0])).toBe(getAddress(res.body.job.vault_address));
    expect((decoded.args as any)[1]).toBe(BigInt(amount));
  });

  it("POST /api/bridge/private/jobs prepares a USDG private bridge job to Solana USDC", async () => {
    const amount = "5000000"; // 5 USDG (6 decimals)
    const res = await request(app)
      .post("/api/bridge/private/jobs")
      .send({
        senderAddress: validSender,
        originCurrency: USDG,
        destinationChainId: 792703809, // Solana
        destinationCurrency: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Solana USDC
        recipient: validSolanaRecipient,
        amount,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.job.asset_symbol).toBe("USDG");
    expect(res.body.job.decimals).toBe(6);
    expect(res.body.job.destination_chain_id).toBe(792703809);
    expect(res.body.job.recipient_address).toBe(validSolanaRecipient);
    expect(res.body.preparedDeposit.to.toLowerCase()).toBe(USDG.toLowerCase());
  });

  it("POST /api/bridge/private/jobs prepares an ETH private bridge job to Solana", async () => {
    const amount = "5000000000000000"; // 0.005 ETH
    const res = await request(app)
      .post("/api/bridge/private/jobs")
      .send({
        senderAddress: validSender,
        originCurrency: NATIVE,
        destinationChainId: 792703809, // Solana
        destinationCurrency: "11111111111111111111111111111111", // SOL
        recipient: validSolanaRecipient,
        amount,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.job.destination_chain_id).toBe(792703809);
    expect(res.body.job.recipient_address).toBe(validSolanaRecipient);
    expect(res.body.preparedDeposit.to.toLowerCase()).toBe(res.body.job.vault_address.toLowerCase());
  });

  it("POST /api/bridge/private/jobs rejects invalid recipient for destination chain", async () => {
    const res = await request(app)
      .post("/api/bridge/private/jobs")
      .send({
        senderAddress: validSender,
        destinationChainId: 8453, // Base expects EVM
        destinationCurrency: NATIVE,
        recipient: "not-an-evm-address",
        amount: "10000000000000000",
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it("POST /api/bridge/private/jobs rejects invalid or non-positive amount", async () => {
    const res = await request(app)
      .post("/api/bridge/private/jobs")
      .send({
        senderAddress: validSender,
        destinationChainId: 8453,
        destinationCurrency: NATIVE,
        recipient: validBaseRecipient,
        amount: "0",
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it("POST /api/bridge/private/jobs/:id/deposit attaches deposit transaction hash", async () => {
    const createRes = await request(app)
      .post("/api/bridge/private/jobs")
      .send({
        senderAddress: validSender,
        destinationChainId: 8453,
        destinationCurrency: NATIVE,
        recipient: validBaseRecipient,
        amount: "10000000000000000",
      });

    const jobId = createRes.body.job.id;
    const fakeTxHash = "0x" + "a".repeat(64);

    const depositRes = await request(app)
      .post(`/api/bridge/private/jobs/${jobId}/deposit`)
      .send({ txHash: fakeTxHash });

    expect([200, 202]).toContain(depositRes.status);
    expect(depositRes.body.success).toBe(true);

    const getRes = await request(app).get(`/api/bridge/private/jobs/${jobId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.job.deposit_tx_hash).toBe(fakeTxHash);
  });

  it("GET /api/bridge/private/jobs/:id returns 404 for unknown job ID", async () => {
    const res = await request(app).get("/api/bridge/private/jobs/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

