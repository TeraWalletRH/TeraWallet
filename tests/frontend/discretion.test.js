import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALWAYS_SHOWN,
  DEFAULT_THRESHOLD,
  MASK,
  conceal,
  concealable,
  hiddenNote,
  partitionSmall,
} from "../../public/tera/core/discretion.js";

const rows = [
  { symbol: "ETH", amount: "1.2", value: 3400 },
  { symbol: "USDG", amount: "12", value: 12 },
  { symbol: "DUST", amount: "0.004", value: 0.31 },
  { symbol: "TINY", amount: "9", value: 0 },
];

test("off by default, so nothing disappears until it is asked for", () => {
  const result = partitionSmall(rows);
  assert.equal(result.shown.length, rows.length);
  assert.deepEqual(result.hidden, []);
  assert.equal(result.hiddenValue, null);
});

test("holds back what is under the threshold and keeps what is on it", () => {
  const { shown, hidden } = partitionSmall(rows, { on: true, threshold: 1 });
  assert.deepEqual(
    shown.map((row) => row.symbol),
    ["ETH", "USDG"],
  );
  assert.deepEqual(
    hidden.map((row) => row.symbol),
    ["DUST", "TINY"],
  );
});

test("what is hidden is still counted, and handed back rather than only tallied", () => {
  const { hidden, hiddenValue } = partitionSmall(rows, { on: true, threshold: 1 });
  // The rows themselves come back, so a surface can offer to show them
  // instead of only admitting they are there.
  assert.equal(hidden[0].amount, "0.004");
  assert.equal(hiddenValue, 0.31);
});

test("a holding nobody has priced is never called small", () => {
  // Not knowing what something is worth is not evidence that it is worth
  // little. This is the asset it would be worst to hide by accident.
  const unpriced = [{ symbol: "RWA", amount: "500", value: null }];
  const { shown, hidden } = partitionSmall(unpriced, { on: true, threshold: 1000000 });
  assert.deepEqual(
    shown.map((row) => row.symbol),
    ["RWA"],
  );
  assert.deepEqual(hidden, []);
});

test("a threshold of zero or nonsense hides nothing rather than everything", () => {
  for (const threshold of [0, -5, NaN, "abc", null]) {
    const { hidden } = partitionSmall(rows, { on: true, threshold });
    assert.deepEqual(hidden, [], `threshold ${String(threshold)} hid something`);
  }
});

test("an unspecified threshold means the default, not no threshold", () => {
  // undefined is absence, which the default answers; null is a stored setting
  // that came back empty, which is not a licence to pick a number.
  const omitted = partitionSmall(rows, { on: true });
  const explicit = partitionSmall(rows, { on: true, threshold: undefined });
  assert.deepEqual(
    omitted.hidden.map((row) => row.symbol),
    ["DUST", "TINY"],
  );
  assert.deepEqual(explicit.hidden, omitted.hidden);
});

test("hiddenValue is null when nothing was hidden, never a confident zero", () => {
  const { hiddenValue } = partitionSmall([{ symbol: "ETH", amount: "1", value: 3400 }], {
    on: true,
    threshold: 1,
  });
  assert.equal(hiddenValue, null);
});

test("the note says how much is missing, and says nothing when nothing is", () => {
  assert.equal(hiddenNote([]), "");
  assert.equal(hiddenNote([{ symbol: "DUST" }]), "1 small balance hidden");
  assert.equal(
    hiddenNote([{ symbol: "DUST" }, { symbol: "TINY" }], { formatted: "$0.31" }),
    "2 small balances hidden, worth $0.31",
  );
});

test("privacy mode covers a figure with a fixed-width mask", () => {
  assert.equal(conceal("$3,400.00", { on: true }), MASK);
  assert.equal(conceal("$3,400.00", { on: false }), "$3,400.00");
  // A mask that grew with the number would tell a bystander the size of what
  // it is hiding.
  assert.equal(conceal("$1.00", { on: true }), conceal("$9,999,999.00", { on: true }));
});

test("privacy mode never covers the figure being authorised", () => {
  for (const context of ALWAYS_SHOWN) {
    assert.equal(concealable(context), false, `${context} was concealable`);
    assert.equal(conceal("$250.00", { on: true, context }), "$250.00");
  }
  assert.equal(concealable("home"), true);
  assert.equal(conceal("$250.00", { on: true, context: "home" }), MASK);
});

test("review and sign are in the always-shown list, not merely absent from it", () => {
  // Stated as a test rather than left to a reader of the array, because the
  // cost of quietly dropping one of these is an owner approving an amount the
  // wallet declined to show them.
  assert.ok(ALWAYS_SHOWN.includes("review"));
  assert.ok(ALWAYS_SHOWN.includes("sign"));
});

test("the default threshold is a dollar", () => {
  assert.equal(DEFAULT_THRESHOLD, 1);
});
