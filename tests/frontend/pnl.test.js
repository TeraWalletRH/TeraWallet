import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RANGES,
  groupEvents,
  portfolioSeries,
  positions,
  priceNear,
  summarise,
} from "../../public/tera/core/pnl.js";

const H = 3_600_000;
const D = 86_400_000;
const NOW = 1_800_000_000_000;
const leg = (hash, timestamp, symbol, amount, direction) => ({
  hash,
  timestamp,
  symbol,
  amount: String(amount),
  direction,
});
const close = (actual, expected, label = "") =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label} ${actual} ≠ ${expected}`);

test("legs are grouped by transaction, oldest first, and netted per asset", () => {
  const events = groupEvents([
    leg("0xb", 2000, "SPCX", 1, "in"),
    leg("0xb", 2000, "USDG", 400, "out"),
    leg("0xa", 1000, "ETH", 1, "in"),
    // A swap that refunds part of what it took.
    leg("0xc", 3000, "ETH", 0.5, "out"),
    leg("0xc", 3000, "ETH", 0.1, "in"),
    leg("0xc", 3000, "TERA", 100, "in"),
    leg("0xd", 4000, "USDG", 0, "in"),
  ]);
  assert.deepEqual(
    events.map((e) => e.hash),
    ["0xa", "0xb", "0xc"],
  );
  assert.deepEqual(events[2].outs, [{ symbol: "ETH", amount: 0.4 }]);
  assert.deepEqual(events[2].ins, [{ symbol: "TERA", amount: 100 }]);
});

test("prices are read from the nearest point, and only when it is close enough", () => {
  const series = [
    { t: 0, p: 1 },
    { t: 10 * H, p: 2 },
    { t: 20 * H, p: 3 },
  ];
  assert.equal(priceNear(series, 9 * H, H), 2);
  assert.equal(priceNear(series, 14 * H, H), null);
  assert.equal(priceNear(series, 14 * H, 5 * H), 2);
  assert.equal(priceNear([], 0, H), null);
  assert.equal(priceNear([{ t: 0, p: 0 }], 0, H), null);
});

test("buying with USDG is exact; selling realises the gain at average cost", () => {
  const events = groupEvents([
    leg("1", 1, "USDG", 400, "out"),
    leg("1", 1, "SPCX", 1, "in"),
    leg("2", 2, "USDG", 600, "out"),
    leg("2", 2, "SPCX", 1, "in"),
    // Sell half at $700 each.
    leg("3", 3, "SPCX", 1, "out"),
    leg("3", 3, "USDG", 700, "in"),
  ]);
  const book = positions(events, () => null);
  close(book.SPCX.qty, 1);
  close(book.SPCX.cost, 500);
  close(book.SPCX.realized, 200, "realized");
  assert.equal(book.SPCX.estimated, false);
  assert.equal(book.SPCX.realizedEstimated, false);
  const { rows, total } = summarise({ book, holdings: { SPCX: 1 }, prices: { SPCX: 650 } });
  assert.equal(rows[0].source, "exact");
  close(rows[0].average, 500);
  close(rows[0].unrealized, 150);
  close(rows[0].percent, 30);
  close(total.realized, 200);
  assert.equal(total.estimated, false);
});

test("a token received from someone costs the market price that day, marked as an estimate", () => {
  const events = groupEvents([leg("1", 5 * D, "TERA", 100, "in")]);
  const book = positions(events, (symbol) => (symbol === "TERA" ? 0.3 : null));
  const { rows, total } = summarise({ book, holdings: { TERA: 100 }, prices: { TERA: 0.45 } });
  assert.equal(rows[0].source, "estimated");
  close(rows[0].costBasis, 30);
  close(rows[0].unrealized, 15);
  assert.equal(total.estimated, true);
});

test("an unknown cost is never counted as zero", () => {
  const events = groupEvents([leg("1", 1, "SPCX", 2, "in")]);
  const book = positions(events, () => null);
  const { rows, total } = summarise({ book, holdings: { SPCX: 2 }, prices: { SPCX: 500 } });
  assert.equal(rows[0].source, "unknown");
  assert.equal(rows[0].unrealized, null);
  assert.deepEqual(total.unknown, ["SPCX"]);
  close(total.unrealized, 0);
  close(total.value, 0);
});

test("holding more than history explains makes the cost unknown, unless the owner sets it", () => {
  const events = groupEvents([leg("1", 1, "USDG", 400, "out"), leg("1", 1, "SPCX", 1, "in")]);
  const book = positions(events, () => null);
  const without = summarise({ book, holdings: { SPCX: 3 }, prices: { SPCX: 500 } });
  assert.equal(without.rows[0].source, "unknown");
  const withOwn = summarise({
    book,
    holdings: { SPCX: 3 },
    prices: { SPCX: 500 },
    overrides: { SPCX: "450" },
  });
  assert.equal(withOwn.rows[0].source, "manual");
  close(withOwn.rows[0].unrealized, 150);
});

test("a plain send removes units at average cost and realises nothing", () => {
  const events = groupEvents([
    leg("1", 1, "USDG", 1000, "out"),
    leg("1", 1, "SPCX", 2, "in"),
    leg("2", 2, "SPCX", 1, "out"),
  ]);
  const book = positions(events, () => null);
  close(book.SPCX.qty, 1);
  close(book.SPCX.cost, 500);
  close(book.SPCX.realized, 0);
});

test("TERA bought with ETH costs the ETH's value that day, and spending ETH is a sale of ETH", () => {
  const prices = { ETH: 2000, TERA: 0.4 };
  const events = groupEvents([
    leg("0", 1, "USDG", 2000, "out"),
    leg("0", 1, "ETH", 1, "in"),
    leg("1", 2, "ETH", 0.01, "out"),
    leg("1", 2, "TERA", 50, "in"),
  ]);
  const book = positions(events, (symbol) => prices[symbol] ?? null);
  close(book.TERA.cost, 20);
  assert.equal(book.TERA.estimated, true);
  // The ETH spent was bought at $2000 and was worth $2000: no gain.
  close(book.ETH.realized, 0);
  close(book.ETH.qty, 0.99);
});

test("the chart undoes later transfers to find what was held at each moment", () => {
  const events = groupEvents([
    leg("buy", NOW - 12 * H, "USDG", 400, "out"),
    leg("buy", NOW - 12 * H, "SPCX", 1, "in"),
  ]);
  const series = {
    SPCX: Array.from({ length: 25 }, (_, i) => ({ t: NOW - D + i * H, p: 400 + i })),
  };
  const { points, excluded } = portfolioSeries({
    holdings: { SPCX: 1, USDG: 600 },
    events,
    series,
    range: "1D",
    now: NOW,
    steps: 24,
  });
  assert.deepEqual(excluded, []);
  assert.equal(points.length, 25);
  // A day ago: 1000 USDG, no SPCX.
  close(points[0].p, 1000);
  // Now: 600 USDG + 1 SPCX at 424.
  close(points[24].p, 1024);
  // Just after the buy: 600 + 1 × 412.
  close(points[13].p, 600 + 413);
});

test("a token with no price for part of the range is left out of the whole line, and named", () => {
  const { points, excluded } = portfolioSeries({
    holdings: { SPCX: 1, USDG: 10 },
    events: [],
    series: { SPCX: [{ t: NOW, p: 500 }] },
    range: "1W",
    now: NOW,
    steps: 7,
  });
  assert.deepEqual(excluded, ["SPCX"]);
  assert.ok(points.every((point) => point.p === 10));
  assert.deepEqual(
    portfolioSeries({ holdings: { X: 1 }, events: [], series: {}, now: NOW }).points,
    [],
  );
  assert.deepEqual(Object.keys(RANGES), ["1D", "1W", "1M", "1Y"]);
});

test("a trade is valued once, so disagreeing market prices cannot invent a gain", () => {
  // Bought 1 ETH for $2000, then swapped it for TERA. The market says the TERA
  // received is worth far more than the ETH paid — prices disagree.
  const prices = { ETH: 2000, TERA: 1 };
  const events = groupEvents([
    leg("0", 1, "USDG", 2000, "out"),
    leg("0", 1, "ETH", 1, "in"),
    leg("1", 2, "ETH", 1, "out"),
    leg("1", 2, "TERA", 1000000, "in"),
  ]);
  const book = positions(events, (symbol) => prices[symbol] ?? null);
  // The swap is worth what was paid: $2000. No gain on the ETH, TERA cost $2000.
  close(book.ETH.realized, 0);
  close(book.TERA.cost, 2000);
  // Selling TERA for USDG: the stable side sets the value exactly.
  const sold = positions(
    groupEvents([
      leg("0", 1, "USDG", 2000, "out"),
      leg("0", 1, "TERA", 1000, "in"),
      leg("1", 2, "TERA", 1000, "out"),
      leg("1", 2, "USDG", 2500, "in"),
    ]),
    () => 999,
  );
  close(sold.TERA.realized, 500);
  assert.equal(sold.TERA.realizedEstimated, false);
});

test("rounding dust is neither a gain nor a loss", async () => {
  const { sign } = await import("../../public/tera/core/pnl.js");
  assert.equal(sign(-3.5e-15), "");
  assert.equal(sign(0.004), "");
  assert.equal(sign(0.01), "+");
  assert.equal(sign(-0.01), "−");
});
