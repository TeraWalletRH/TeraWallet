import { expect, test } from "bun:test";
import { reviewIntelligence } from "../src/intelligence";

test("flags a first-time contract recipient and gives a concrete next step", () => {
  const result = reviewIntelligence({
    action: "send", send: "10 USDG", recipient: "0x1111111111111111111111111111111111111111",
    owner: "0x2222222222222222222222222222222222222222", knownRecipient: false,
    recipientHasCode: true, steps: 1, simulation: "passed",
  });
  expect(result.preview).toContain("send 10 USDG");
  expect(result.risks).toEqual(expect.arrayContaining([
    expect.stringContaining("not in your saved contacts"),
    expect.stringContaining("recipient is a contract"),
  ]));
  expect(result.safer).toEqual(expect.arrayContaining([expect.stringContaining("full address")]));
});

test("explains quote, price impact, approvals and estimated gas without claiming safety", () => {
  const result = reviewIntelligence({
    action: "buy AAPL using", send: "100 USDG", steps: 2, simulation: "passed",
    estimatedFeeEth: "0.000021", quote: {
      route: "direct", priceImpactPct: 3.2, amountOut: "0.5 AAPL", minimumOut: "0.495 AAPL",
      comparedRoutes: [{ route: "direct", amountOut: "0.5" }, { route: "via WETH", amountOut: "0.48" }],
    },
  });
  expect(result.risks).toEqual(expect.arrayContaining([expect.stringContaining("3.20%"), expect.stringContaining("approval step")]));
  expect(result.route).toContain("1% slippage limit");
  expect(result.route).toContain("Compared:");
  expect(result.networkFee).toContain("0.000021 ETH");
});

test("uses the selected language for review guidance", () => {
  const result = reviewIntelligence({ language: "zh", action: "发送", send: "10 USDG", steps: 1,
    simulation: "needs-attention", gasEstimateUnavailable: true });
  expect(result.preview).toContain("即将进行");
  expect(result.risks[0]).toContain("交易模拟");
  expect(result.networkFee).toContain("网络费");
});
