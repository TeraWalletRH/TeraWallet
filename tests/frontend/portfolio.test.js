import { test } from "node:test";
import assert from "node:assert/strict";

function computePortfolioPoints(totalUsdValue, change24hPct = 0, steps = 12) {
  const points = [];
  const now = Date.now();
  const stepMs = (24 * 3600 * 1000) / steps;
  const startVal = totalUsdValue / (1 + change24hPct / 100);
  const diff = totalUsdValue - startVal;

  for (let i = 0; i <= steps; i++) {
    const t = now - (steps - i) * stepMs;
    const progress = i / steps;
    const value = Math.max(0, startVal + diff * progress);
    points.push({ t, value: Number(value.toFixed(2)) });
  }

  return points;
}

test("computePortfolioPoints computes smooth 24h portfolio trajectory", () => {
  const points = computePortfolioPoints(1000, 10, 12);
  assert.equal(points.length, 13);
  assert.equal(points[12].value, 1000);
  assert.ok(points[0].value < 1000);
});

test("computePortfolioPoints handles flat prices", () => {
  assert.equal(computePortfolioPoints(100, 0, 4).length, 5);
});
