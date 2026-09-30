import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockTime,
  confirmMs,
  estimateConfirmMs,
  formatDuration,
  formatGwei,
  formatLatency,
  offline,
  rate,
  reading,
  transferFeeWei,
} from "../../public/tera/core/network-speed.js";

test("block time is averaged over the blocks between two readings", () => {
  assert.equal(blockTime({ number: 1100, timestamp: 1025 }, { number: 1000, timestamp: 1000 }), 250);
  assert.equal(blockTime({ number: 5, timestamp: 10 }, { number: 5, timestamp: 10 }), null);
  assert.equal(blockTime(null, null), null);
});

test("the level: fast, normal, slow, or down", () => {
  assert.equal(rate({ latencyMs: 120, blockTimeMs: 250, blockAgeMs: 1000 }), "fast");
  assert.equal(rate({ latencyMs: 600, blockTimeMs: 250, blockAgeMs: 1000 }), "normal");
  assert.equal(rate({ latencyMs: 120, blockTimeMs: 3000, blockAgeMs: 1000 }), "normal");
  assert.equal(rate({ latencyMs: 2000, blockTimeMs: 250, blockAgeMs: 1000 }), "slow");
  assert.equal(rate({ latencyMs: 120, blockTimeMs: 250, blockAgeMs: 30_000 }), "slow");
  // A chain that stopped making blocks is down even if the node answers quickly.
  assert.equal(rate({ latencyMs: 120, blockTimeMs: 250, blockAgeMs: 120_000 }), "down");
  assert.equal(rate({ latencyMs: null }), "down");
  assert.equal(offline(5).level, "down");
});

test("a reading puts it together, with an estimate for a transaction sent now", () => {
  const now = 1_000_000_000;
  const r = reading({
    newest: { number: 1100n, timestamp: BigInt(now / 1000 - 1) },
    older: { number: 1000n, timestamp: BigInt(now / 1000 - 26) },
    latencyMs: 100,
    gasPriceWei: 10_000_000n,
    now,
  });
  assert.equal(r.level, "fast");
  assert.equal(r.block, 1100);
  assert.equal(r.blockTimeMs, 250);
  assert.equal(r.blockAgeMs, 1000);
  assert.equal(r.estimateMs, 450);
  assert.equal(estimateConfirmMs({ latencyMs: null }), null);
});

test("a transaction's speed runs from signing to its block", () => {
  assert.equal(confirmMs(10_000, 12), 2000);
  // The block is stamped in whole seconds, so it can read slightly before the signing.
  assert.equal(confirmMs(10_400, 10), 0);
  assert.equal(confirmMs(60_000, 10), null);
  assert.equal(confirmMs(undefined, 10), null);
  assert.equal(confirmMs(10_000, null), null);
});

test("durations, latency and gas read plainly", () => {
  assert.equal(formatDuration(0), "under 1s");
  assert.equal(formatDuration(4_400), "4s");
  assert.equal(formatDuration(125_000), "2m 5s");
  assert.equal(formatDuration(3_780_000), "1h 3m");
  assert.equal(formatDuration(null), "");
  assert.equal(formatLatency(123.4), "123 ms");
  assert.equal(formatLatency(1400), "1.4 s");
  assert.equal(formatGwei(10_000_000n), "0.01");
  assert.equal(formatGwei(12_500_000_000n), "12.5");
  assert.equal(formatGwei(0n), "0");
  assert.equal(transferFeeWei(10n), 650_000n);
  assert.equal(transferFeeWei(null), null);
});
