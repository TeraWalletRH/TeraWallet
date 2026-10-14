import { test } from "node:test";
import assert from "node:assert/strict";
import { STALE_MS, age, label, stale, tick } from "../../public/tera/core/freshness.js";

const NOW = 1_800_000_000_000;

test("just now, then seconds, minutes, hours, days, rounded down", () => {
  assert.equal(label(NOW - 4_999, NOW), "just now");
  assert.equal(label(NOW - 12_900, NOW), "12s ago");
  assert.equal(label(NOW - 59_999, NOW), "59s ago");
  assert.equal(label(NOW - 3 * 60_000 - 59_000, NOW), "3m ago");
  assert.equal(label(NOW - 2 * 3_600_000, NOW), "2h ago");
  assert.equal(label(NOW - 3 * 86_400_000, NOW), "3d ago");
});

test("never read: no stamp", () => {
  assert.equal(age(0, NOW), null);
  assert.equal(age(undefined, NOW), null);
  assert.equal(label(null, NOW), "");
});

test("a clock that runs behind never shows a negative age", () => {
  assert.equal(label(NOW + 10_000, NOW), "just now");
});

test("stale after 90 seconds, or whenever the last read failed", () => {
  assert.equal(stale(NOW - STALE_MS, NOW), false);
  assert.equal(stale(NOW - STALE_MS - 1, NOW), true);
  assert.equal(stale(NOW - 1_000, NOW, true), true);
  assert.equal(stale(0, NOW), false);
  assert.equal(stale(0, NOW, true), true);
});

test("ticks every second for a minute, then every 30 seconds", () => {
  assert.equal(tick(NOW - 10_000, NOW), 1_000);
  assert.equal(tick(NOW - 120_000, NOW), 30_000);
});
