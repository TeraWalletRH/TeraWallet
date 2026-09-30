import { test } from "node:test";
import assert from "node:assert/strict";
import {
  check,
  clean,
  fromDollars,
  hasAny,
  loosens,
  remaining,
  toDollars,
} from "../../public/tera/core/limits.js";

const usd = (n) => BigInt(Math.round(n * 100)) * 10000n;
const now = new Date(2026, 8, 20, 15).getTime();
const at = (day, hour = 12) => new Date(2026, 8, day, hour).getTime();
const rows = [
  { activityType: "send", activityAmount: "40 USDG", createdAt: at(20, 9) },
  {
    activityType: "send",
    activityAmount: "0.01 ETH",
    spendUsd: usd(30).toString(),
    createdAt: at(20, 10),
  },
  { activityType: "send", activityAmount: "200 USDG", createdAt: at(3) },
  { activityType: "swap", activityAmount: "500 USDG", createdAt: at(20, 11) },
];

test("no limits lets everything through, including what has no price", () => {
  assert.equal(hasAny({}), false);
  assert.deepEqual(check({ limits: {}, amount: null, rows, now }), { ok: true });
});

test("a payment over the per-payment cap is stopped", () => {
  const result = check({ limits: { perPayment: usd(50).toString() }, amount: usd(60), rows, now });
  assert.equal(result.kind, "perPayment");
  assert.equal(result.limit, usd(50));
});

test("today's sends, in any asset, count against the daily cap; swaps do not", () => {
  const limits = { daily: usd(100).toString() };
  assert.equal(check({ limits, amount: usd(30), rows, now }).ok, true);
  const over = check({ limits, amount: usd(31), rows, now });
  assert.equal(over.kind, "daily");
  assert.equal(over.used, usd(70));
  assert.equal(over.after, usd(101));
});

test("the month counts from the 1st", () => {
  const over = check({ limits: { monthly: usd(300).toString() }, amount: usd(31), rows, now });
  assert.equal(over.kind, "monthly");
  assert.equal(over.used, usd(270));
  assert.deepEqual(remaining({ monthly: usd(300).toString() }, rows, now), {
    perPayment: null,
    daily: null,
    monthly: usd(30),
  });
});

test("with a cap set, a payment with no dollar value is refused", () => {
  assert.equal(check({ limits: { daily: "1000000" }, amount: null, rows, now }).kind, "unpriced");
});

test("the form reads dollars, blanks mean no cap, and caps must nest", () => {
  const read = fromDollars({ perPayment: "50", daily: "", monthly: "1,000.5" });
  assert.equal(read.ok, true);
  assert.deepEqual(read.limits, { perPayment: "50000000", daily: null, monthly: "1000500000" });
  assert.deepEqual(toDollars(read.limits), { perPayment: "50", daily: "", monthly: "1000.5" });
  assert.equal(fromDollars({ perPayment: "12.345" }).ok, false);
  assert.equal(fromDollars({ perPayment: "200", daily: "100" }).kind, "perPayment");
  assert.equal(fromDollars({ daily: "200", monthly: "100" }).kind, "daily");
  assert.deepEqual(clean({ daily: "0", monthly: "abc" }), {
    perPayment: null,
    daily: null,
    monthly: null,
  });
});

test("raising or removing a cap loosens; lowering or adding one does not", () => {
  const before = { daily: "100000000" };
  assert.equal(loosens(before, { daily: "200000000" }), true);
  assert.equal(loosens(before, {}), true);
  assert.equal(loosens(before, { daily: "50000000" }), false);
  assert.equal(loosens(before, { daily: "100000000", monthly: "900000000" }), false);
  assert.equal(loosens({}, { daily: "1" }), false);
});
