import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEVELS,
  assess,
  consentText,
  formatPct,
  message,
  rowText,
} from "../../public/tera/core/price-impact.js";

test("each level starts where it says", () => {
  assert.equal(assess(0.3).level, "low");
  assert.equal(assess(0.999).level, "low");
  assert.equal(assess(LEVELS.warn).level, "warn");
  assert.equal(assess(4.99).level, "warn");
  assert.equal(assess(LEVELS.confirm).level, "confirm");
  assert.equal(assess(14.99).level, "confirm");
  assert.equal(assess(LEVELS.block).level, "blocked");
  assert.equal(assess(60).level, "blocked");
});

test("a negative figure from a sub-unit trade is no impact", () => {
  const result = assess(-0.4, 50);
  assert.equal(result.level, "low");
  assert.equal(result.pct, 0);
  assert.equal(result.costUsd, 0);
});

test("a missing figure is unknown, never treated as zero", () => {
  for (const value of [undefined, null, Number.NaN, "2"]) {
    const result = assess(/** @type {any} */ (value), 100);
    assert.equal(result.level, "unknown");
    assert.equal(rowText(result), "Not available for this route");
    assert.equal(message(result), "");
  }
});

test("the dollar cost is the impact share of what is swapped", () => {
  const result = assess(8.4, 500);
  assert.equal(result.costUsd, 42);
  assert.equal(rowText(result), "8.4% (≈ $42.00)");
  assert.match(message(result), /lose about 8\.4% \(≈ \$42\.00\)/);
  assert.equal(
    consentText(result),
    "I understand I'll lose about 8.4% (≈ $42.00) to price impact.",
  );
  assert.equal(rowText(assess(0.3)), "0.30%");
  assert.equal(rowText(assess(0.001, 1)), "0.00% (≈ $0.01)");
  assert.match(message(assess(2.4, 500)), /moves the price about 2\.4% against you \(≈ \$12\.00\)/);
  assert.match(message(assess(20, 1000)), /too thin for this amount/);
  assert.equal(formatPct(12), "12.0%");
});
