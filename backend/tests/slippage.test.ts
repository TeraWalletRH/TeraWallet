import { describe, expect, it } from "bun:test";
import { checkRiskEngine } from "../src/pipeline/gates";
import type { UserIntent } from "../src/pipeline/types";

const swap: UserIntent = {
  ownerAddress: "0x1111111111111111111111111111111111111111",
  actionType: "BUY",
  assetAddress: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
  amount: "1000000",
};

describe("swap slippage at the risk engine", () => {
  it("defaults to 1% when the intent names none", async () => {
    const gate = await checkRiskEngine(swap);
    expect(gate.passed).toBe(true);
    expect(gate.details?.slippageToleranceBps).toBe(100);
  });

  it("reports the owner's choice within 0.1%–5%", async () => {
    for (const slippageBps of [10, 50, 300, 500]) {
      const gate = await checkRiskEngine({ ...swap, slippageBps });
      expect(gate.passed).toBe(true);
      expect(gate.details?.slippageToleranceBps).toBe(slippageBps);
    }
  });

  it("refuses a limit outside the bounds or not a whole number", async () => {
    for (const slippageBps of [0, 9, 501, 5000, 1.5, -100, Number.NaN]) {
      const gate = await checkRiskEngine({ ...swap, slippageBps });
      expect(gate.passed).toBe(false);
      expect(gate.reason).toContain("Slippage must be between");
    }
  });

  it("refuses a slippage limit on a transfer", async () => {
    const gate = await checkRiskEngine({ ...swap, actionType: "TRANSFER", slippageBps: 100 });
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("only to swaps");
  });
});
