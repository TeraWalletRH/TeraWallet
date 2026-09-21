import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETE,
  PARTIAL,
  NONE,
  PRICE_SOURCES,
  LIMITS,
  valueOf,
  totalValue,
  summarise,
  format,
} from "../../public/tera/core/value.js";

const holdings = [
  { symbol: "USDG", amount: "100" },
  { symbol: "NVDA", amount: "2" },
];
const prices = { USDG: 1, NVDA: 150 };

test("a total is the sum of what could actually be priced", () => {
  const result = totalValue(holdings, prices);
  assert.equal(result.coverage, COMPLETE);
  assert.equal(result.total, 400);
  assert.equal(result.priced.length, 2);
  assert.deepEqual(result.unpriced, []);
});

test("an unpriced holding is never counted as worth nothing", () => {
  // The bug this module exists to make impossible. The version it replaces multiplied by
  // `prices[symbol] || 0`, so a missing price silently removed a holding from the total
  // while the figure still rendered as complete.
  const result = totalValue(holdings, { USDG: 1 });
  assert.equal(result.coverage, PARTIAL);
  assert.equal(result.total, 100);
  assert.deepEqual(
    result.unpriced.map((entry) => entry.symbol),
    ["NVDA"],
  );
  assert.match(summarise(result), /subtotal/i);
  assert.match(summarise(result), /NVDA/);
  assert.match(summarise(result), /rather than counted as nothing/i);
});

test("no prices at all is not a portfolio worth zero", () => {
  const result = totalValue(holdings, {});
  assert.equal(result.coverage, NONE);
  // Null rather than 0, so a surface that ignores `coverage` renders an empty slot
  // instead of a confident "$0.00".
  assert.equal(result.total, null);
  assert.equal(format(result.total), "—");
  assert.match(summarise(result), /balances are unaffected/i);
});

test("a zero balance with no price is not reported as a gap", () => {
  // It would contribute nothing either way, and naming it would send an owner looking
  // for a figure that does not exist.
  const result = totalValue(
    [
      { symbol: "USDG", amount: "5" },
      { symbol: "NVDA", amount: "0" },
    ],
    {
      USDG: 1,
    },
  );
  assert.equal(result.coverage, COMPLETE);
  assert.equal(result.total, 5);
  assert.deepEqual(result.unpriced, []);
});

test("a malformed balance or price is left out, never turned into NaN", () => {
  const result = totalValue(
    [
      { symbol: "USDG", amount: "100" },
      { symbol: "NVDA", amount: "not a number" },
      { symbol: "ETH", amount: "1" },
    ],
    { USDG: 1, NVDA: 150, ETH: "3000" },
  );
  assert.equal(result.total, 100);
  assert.ok(Number.isFinite(result.total));
  // A price that is not a number is a price that could not be read.
  assert.deepEqual(
    result.unpriced.map((entry) => entry.symbol),
    ["ETH"],
  );
});

test("a negative price is refused rather than subtracted from the total", () => {
  const result = totalValue([{ symbol: "NVDA", amount: "2" }], { NVDA: -150 });
  assert.equal(result.coverage, NONE);
  assert.equal(result.total, null);
});

test("one holding values to null when either side is missing", () => {
  assert.equal(valueOf("2", 150), 300);
  assert.equal(valueOf("2", undefined), null);
  assert.equal(valueOf(undefined, 150), null);
  assert.equal(valueOf("2", Number.NaN), null);
});

test("the summary names when prices were read, when it is told", () => {
  const result = totalValue(holdings, prices);
  assert.match(summarise(result, { asOf: "14:05:00" }), /read 14:05:00/i);
  // And says nothing about freshness when it has nothing to say.
  assert.ok(!/read/i.test(summarise(result)));
});

test("the sources and limits say what a figure is not", () => {
  const text = [...PRICE_SOURCES.map((source) => source.detail), ...LIMITS].join(" ");
  assert.match(text, /not an offer/i);
  assert.match(text, /one unit/i);
  assert.match(text, /definition/i);
  // The privacy claim has to survive in the list an owner actually reads.
  assert.match(text, /no address|carries no address/i);
});
