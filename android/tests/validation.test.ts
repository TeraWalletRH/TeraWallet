import { describe, expect, it } from "bun:test";
import { encodeFunctionData, zeroAddress } from "viem";
import { destinations, DEPOSITORY, sources, USDG } from "../src/config";
import { transferTx, verifyBridge, verifyTransfer } from "../src/validation";
import { swapAbi, verifyProposal } from "../src/proposals";
const owner = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const word = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
describe("signing boundary", () => {
  it("checks native and token transfers against amount and recipient", () => {
    for (const token of [zeroAddress, USDG]) {
      const tx = transferTx(token, recipient, "42");
      expect(() => verifyTransfer(tx, token, recipient, "42")).not.toThrow();
      expect(() => verifyTransfer(tx, token, owner, "42")).toThrow();
      expect(() => verifyTransfer(tx, token, recipient, "43")).toThrow();
      expect(() => verifyTransfer({ ...tx, chainId: 1 }, token, recipient, "42")).toThrow();
    }
  });
  it("supports every configured bridge pair and rejects amount, recipient, token, and expiry changes", () => {
    const now = Date.now();
    for (const source of sources)
      for (const dest of destinations)
        for (const token of dest.tokens) {
          const input = {
            ownerAddress: owner,
            originCurrency: source.address,
            destinationCurrency: token.address,
            destinationChainId: dest.id,
            recipient:
              dest.id === 792703809 ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : recipient,
            amount: "1000000",
          };
          const native = source.address === zeroAddress;
          const data = native
            ? `0x49290c1c${word(owner)}${"a".repeat(64)}`
            : `0xe8017952${word(owner)}${word(USDG)}${1000000n.toString(16).padStart(64, "0")}${"a".repeat(64)}`;
          const q = {
            requestId: `0x${"b".repeat(64)}`,
            input: { ...input, destination: { currency: token.address, decimals: token.decimals } },
            amountOut: "100000",
            minimumAmountOut: "99500",
            expiresAt: now + 120000,
            steps: [
              {
                id: "deposit",
                chainId: 4663,
                to: DEPOSITORY,
                data,
                value: native ? "1000000" : "0",
              },
            ],
          };
          expect(() => verifyBridge(q, input, now)).not.toThrow();
          expect(() => verifyBridge(q, { ...input, recipient: owner }, now)).toThrow();
          expect(() => verifyBridge(q, { ...input, amount: "1000001" }, now)).toThrow();
          expect(() => verifyBridge(q, { ...input, destinationCurrency: owner }, now)).toThrow();
          expect(() => verifyBridge(q, input, now + 120000)).toThrow();
          if (native)
            expect(() =>
              verifyBridge({ ...q, steps: [{ ...q.steps[0], value: "0x0" }] }, input, now),
            ).toThrow();
        }
  });
  it("rebuilds exact swap calldata and rejects a different recipient", () => {
    const tokenOut = "0x3333333333333333333333333333333333333333";
    const params = {
      tokenIn: USDG,
      tokenOut,
      fee: 500,
      recipient: owner,
      amountIn: 100n,
      amountOutMinimum: 990n,
      sqrtPriceLimitX96: 0n,
    } as const;
    const tx = {
      to: "0xcaf681a66d020601342297493863e78c959e5cb2",
      value: "0",
      chainId: 4663,
      data: encodeFunctionData({ abi: swapAbi, functionName: "exactInputSingle", args: [params] }),
      approvals: [],
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      quote: {
        quotedAt: new Date().toISOString(),
        amountOutWei: "1000",
        routing: { type: "direct", fee: 500 },
      },
    };
    const p = {
      intent: { ownerAddress: owner, assetAddress: tokenOut, actionType: "BUY", amount: "100" },
      gates: [
        "asset_registry",
        "eligibility_preflight",
        "policy_vault",
        "risk_engine",
        "approval_controller",
      ].map((gate) => ({ gate, passed: true })),
      preparedTransaction: tx,
    };
    expect(verifyProposal(p, owner)).toHaveLength(1);
    tx.data = encodeFunctionData({
      abi: swapAbi,
      functionName: "exactInputSingle",
      args: [{ ...params, recipient }],
    });
    expect(() => verifyProposal(p, owner)).toThrow();
  });
});

describe("service check verdicts", () => {
  const proposal = (gates: any[]) => ({
    intent: {
      ownerAddress: owner,
      assetAddress: USDG,
      actionType: "TRANSFER",
      recipient,
      amount: "100",
    },
    gates,
    preparedTransaction: transferTx(USDG, recipient, "100"),
  });
  const five = (overrides: Record<string, any> = {}) =>
    [
      "asset_registry",
      "eligibility_preflight",
      "policy_vault",
      "risk_engine",
      "approval_controller",
    ].map((gate) => ({ gate, passed: true, ...(overrides[gate] || {}) }));

  it("accepts a proposal where every check actually passed", () => {
    expect(verifyProposal(proposal(five()), owner)).toHaveLength(1);
  });

  it("refuses a pass the service could not establish", () => {
    // The eligibility check falls back to the registry entry when the chain is
    // unreachable. It reports passed:true, and before this that was enough.
    const gates = five({ eligibility_preflight: { details: { rpcFallback: true } } });
    expect(() => verifyProposal(proposal(gates), owner)).toThrow(/could not be established/i);
  });

  it("refuses when the risk figures are static defaults rather than a quote", () => {
    const gates = five({ risk_engine: { details: { staticDefaults: true } } });
    expect(() => verifyProposal(proposal(gates), owner)).toThrow(/could not be established/i);
  });

  it("still refuses a blocked check and a missing one, naming which", () => {
    const blocked = five({ policy_vault: { passed: false } });
    expect(() => verifyProposal(proposal(blocked), owner)).toThrow(/blocked it/i);
    const missing = five().filter((g) => g.gate !== "approval_controller");
    expect(() => verifyProposal(proposal(missing), owner)).toThrow(/did not run/i);
  });
});
