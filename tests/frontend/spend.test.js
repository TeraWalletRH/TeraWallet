import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAS_RESERVE_WEI,
  dollarsToUnits,
  formatDollars,
  plan,
  spentThisMonth,
  unitsToAmount,
} from "../../public/tera/core/spend.js";

const usd = (n) => BigInt(Math.round(n * 100)) * 10000n;
const eth = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

test("a dollar amount is cents at most, and more than nothing", () => {
  assert.equal(dollarsToUnits("12"), 12000000n);
  assert.equal(dollarsToUnits("$1,250.5"), 1250500000n);
  assert.equal(dollarsToUnits("0.01"), 10000n);
  assert.equal(dollarsToUnits("12.345"), null);
  assert.equal(dollarsToUnits("0"), null);
  assert.equal(dollarsToUnits("abc"), null);
});

test("dollars are shown rounded down to the cent", () => {
  assert.equal(formatDollars(1234567899n), "$1,234.56");
  assert.equal(formatDollars(0n), "$0.00");
  assert.equal(unitsToAmount(12500000n), "12.5");
  assert.equal(unitsToAmount(12000000n), "12");
});

test("USDG that covers the payment is paid directly", () => {
  const result = plan({ amount: "25", stable: usd(30), eth: 0n, ethPrice: 3000 });
  assert.equal(result.state, "ready");
  assert.equal(result.units, usd(25));
});

test("a shortfall is topped up from ETH with a margin, leaving the fee reserve", () => {
  const result = plan({ amount: "100", stable: usd(40), eth: eth(1), ethPrice: 3000 });
  assert.equal(result.state, "top-up");
  assert.equal(result.shortfall, usd(60));
  assert.equal(result.topUp.dollars, usd(61.2));
  // $61.20 at $3,000 per ETH.
  assert.equal(result.topUp.wei, 20400000000000000n);
});

test("not enough ETH after the fee reserve is short, not a partial payment", () => {
  const result = plan({ amount: "100", stable: 0n, eth: 34000000000000000n, ethPrice: 3000 });
  assert.equal(result.state, "short");
  assert.equal(result.reason, "not-enough");
  const enough = plan({
    amount: "100",
    stable: 0n,
    eth: 34000000000000000n + GAS_RESERVE_WEI,
    ethPrice: 3000,
  });
  assert.equal(enough.state, "top-up");
});

test("an unknown ETH price never guesses a top-up", () => {
  assert.equal(plan({ amount: "10", stable: 0n, eth: eth(5), ethPrice: 0 }).reason, "no-price");
  assert.equal(plan({ amount: "10", stable: 0n, eth: eth(5), ethPrice: NaN }).reason, "no-price");
  assert.equal(plan({ amount: "10.001", stable: 0n, eth: 0n, ethPrice: 1 }).state, "invalid");
});

test("spent this month counts USDG sends, local and on chain, and nothing else", () => {
  const now = new Date(2026, 8, 20).getTime();
  const rows = [
    {
      activityType: "send",
      activityAmount: "12.5 USDG",
      createdAt: new Date(2026, 8, 2).getTime(),
    },
    {
      direction: "send",
      symbol: "USDG",
      amount: "1,000",
      createdAt: new Date(2026, 8, 3).getTime(),
    },
    { activityType: "send", activityAmount: "0.1 ETH", createdAt: new Date(2026, 8, 4).getTime() },
    {
      direction: "receive",
      symbol: "USDG",
      amount: "50",
      createdAt: new Date(2026, 8, 5).getTime(),
    },
    {
      activityType: "send",
      activityAmount: "9 USDG",
      status: "failed",
      createdAt: new Date(2026, 8, 6).getTime(),
    },
    { activityType: "send", activityAmount: "7 USDG", createdAt: new Date(2026, 7, 31).getTime() },
  ];
  assert.deepEqual(spentThisMonth(rows, now), { units: usd(1012.5), count: 2 });
});
