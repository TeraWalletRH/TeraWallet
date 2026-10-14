import { test } from "node:test";
import assert from "node:assert/strict";
import { FEE_CAP_WEI, dollarsForTokens, feeReserve, maxSendable, tokensForDollars } from "../../public/tera/core/max-amount.js";

const ETH = 10n ** 18n;

test("a token's Max is the whole balance", () => {
  assert.equal(maxSendable({ balance: "2500000", native: false, reserve: 999n }), "2500000");
  assert.equal(maxSendable({ balance: undefined, native: false }), "0");
});

test("ETH's Max keeps the fee back", () => {
  const reserve = feeReserve(21000n, 100_000_000n); // 21000 gas at 0.1 gwei, doubled
  assert.equal(reserve, 4_200_000_000_000n);
  assert.equal(maxSendable({ balance: ETH.toString(), native: true, reserve }), (ETH - reserve).toString());
});

test("the fee kept back never exceeds the 0.001 ETH limit; no estimate keeps the limit", () => {
  assert.equal(feeReserve(21000n, 10n ** 12n), FEE_CAP_WEI);
  assert.equal(feeReserve(undefined, 5n), FEE_CAP_WEI);
  assert.equal(feeReserve(0n, 0n), FEE_CAP_WEI);
  assert.equal(feeReserve("garbage", 1n), FEE_CAP_WEI);
});

test("a balance smaller than the fee gives 0, never negative", () => {
  assert.equal(maxSendable({ balance: "100", native: true, reserve: 500n }), "0");
  assert.equal(maxSendable({ balance: "500", native: true, reserve: 500n }), "0");
});

test("dollars to tokens rounds down", () => {
  // $10 of ETH at $3,000 = 0.003333… ETH, rounded down.
  assert.equal(tokensForDollars("10", 3000, 18), "3333333333333333");
  assert.equal(tokensForDollars("25.5", 1, 6), "25500000");
  assert.equal(tokensForDollars(".5", 1, 6), "500000");
  assert.equal(tokensForDollars("", 1, 6), null);
  assert.equal(tokensForDollars("abc", 1, 6), null);
  assert.equal(tokensForDollars("5", 0, 6), null);
  assert.equal(tokensForDollars("5", NaN, 6), null);
});

test("tokens to dollars rounds down to the cent", () => {
  assert.equal(dollarsForTokens((ETH / 3n).toString(), 3000, 18), "999.99");
  assert.equal(dollarsForTokens("25509999", 1, 6), "25.50");
  assert.equal(dollarsForTokens("0", 3000, 18), "0.00");
  assert.equal(dollarsForTokens("1", null, 18), null);
});

test("Max in dollars never comes to more than the balance", () => {
  const max = maxSendable({ balance: "1234567890123456789", native: true, reserve: feeReserve(21000n, 10n ** 8n) });
  const shown = dollarsForTokens(max, 2917.43, 18);
  assert.ok(BigInt(tokensForDollars(shown, 2917.43, 18)) <= BigInt(max));
});
