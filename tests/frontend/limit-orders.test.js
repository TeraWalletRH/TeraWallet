import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  cancelOrder,
  cleanOrders,
  describeOrder,
  evaluate,
  fillOrder,
  limitMinimum,
  meetsLimit,
  parseOrder,
  readyText,
  recordFill,
  saveOrder,
  slippageForLimit,
  sortedOrders,
} from "../../public/tera/core/limit-orders.js";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const hash = `0x${"a".repeat(64)}`;

function order(overrides = {}) {
  const result = parseOrder(
    { side: "buy", asset: "SPCX", amount: "100", limit: "400", expiry: "week", ...overrides },
    { now: NOW },
  );
  assert.ok(result.ok, result.reason);
  return result.order;
}

test("an order is read from the form, with its pair and expiry", () => {
  const buy = order();
  assert.equal(buy.pair, "USDG");
  assert.equal(buy.status, "open");
  assert.equal(buy.expiresAt, NOW + 7 * DAY);
  assert.equal(order({ asset: "TERA" }).pair, "ETH");
  assert.equal(order({ expiry: "never" }).expiresAt, null);
  assert.equal(order({ limit: "$0.40" }).limit, "0.40");
  assert.equal(describeOrder(buy), "Buy SPCX with 100 USDG at $400 or lower");
  assert.equal(
    describeOrder(order({ side: "sell", amount: "2" })),
    "Sell 2 SPCX at $400 or higher",
  );
  for (const [bad, reason] of [
    [{ side: "hold" }, /buy or sell/],
    [{ asset: "USDG" }, /other than USDG/],
    [{ amount: "0" }, /amount/],
    [{ limit: "free" }, /target price/],
    [{ limit: "0.00" }, /target price/],
    [{ expiry: "decade" }, /expires/],
  ]) {
    const result = parseOrder(
      { side: "buy", asset: "SPCX", amount: "100", limit: "400", expiry: "week", ...bad },
      { now: NOW },
    );
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.match(result.reason, reason);
  }
});

test("a buy triggers at or below its limit, a sell at or above", () => {
  const buy = order();
  const sell = order({ side: "sell", amount: "1" });
  assert.equal(meetsLimit(buy, 400), true);
  assert.equal(meetsLimit(buy, 399.99), true);
  assert.equal(meetsLimit(buy, 400.01), false);
  assert.equal(meetsLimit(sell, 400), true);
  assert.equal(meetsLimit(sell, 399.99), false);
  assert.equal(meetsLimit(buy, undefined), false);
  assert.equal(meetsLimit(buy, 0), false);
});

test("once touched an order stays ready, and expiry ends it either way", () => {
  let list = [order(), order({ asset: "TERA", limit: "0.4", expiry: "day" })];
  let result = evaluate(list, { SPCX: 410, TERA: 0.5 }, NOW + 1000);
  assert.equal(result.changed, false);
  result = evaluate(list, { SPCX: 395, TERA: 0.5 }, NOW + 2000);
  assert.equal(result.changed, true);
  assert.deepEqual(
    result.ready.map((o) => o.asset),
    ["SPCX"],
  );
  assert.equal(result.orders[0].readyPrice, 395);
  assert.match(readyText(result.orders[0]), /SPCX reached your \$400 target \(now \$395\)/);
  list = result.orders;
  // The price goes back up: still ready, and not announced again.
  result = evaluate(list, { SPCX: 450, TERA: 0.5 }, NOW + 3000);
  assert.equal(result.orders[0].status, "ready");
  assert.deepEqual(result.ready, []);
  // A day later the TERA order expires; a week later so does the ready one.
  result = evaluate(list, { SPCX: 450, TERA: 0.5 }, NOW + DAY);
  assert.deepEqual(
    result.expired.map((o) => o.asset),
    ["TERA"],
  );
  result = evaluate(result.orders, { SPCX: 450 }, NOW + 7 * DAY);
  assert.equal(result.orders[0].status, "expired");
});

test("the on-chain minimum honours the limit price exactly, rounded up", () => {
  // Spend 100 USDG at $400 or lower: at least 0.25 SPCX (18 decimals).
  assert.equal(
    limitMinimum({ side: "buy", asset: "SPCX", amount: "100", limit: "400", decimalsOut: 18 }),
    250000000000000000n,
  );
  // Sell 2 SPCX at $400 or higher: at least 800 USDG (6 decimals).
  assert.equal(
    limitMinimum({ side: "sell", asset: "SPCX", amount: "2", limit: "400", decimalsOut: 6 }),
    800000000n,
  );
  // 1 USDG at $3: 0.333…34 — rounded up, never below the limit.
  assert.equal(
    limitMinimum({ side: "buy", asset: "SPCX", amount: "1", limit: "3", decimalsOut: 6 }),
    333334n,
  );
  // TERA trades against ETH: 0.01 ETH at $2000/ETH buying TERA at $0.40 → 50 TERA.
  assert.equal(
    limitMinimum({
      side: "buy",
      asset: "TERA",
      amount: "0.01",
      limit: "0.40",
      decimalsOut: 18,
      ethPrice: 2000,
    }),
    50n * 10n ** 18n,
  );
  // Selling 100 TERA at $0.50 with ETH at $2500 → at least 0.02 ETH.
  assert.equal(
    limitMinimum({
      side: "sell",
      asset: "TERA",
      amount: "100",
      limit: "0.50",
      decimalsOut: 18,
      ethPrice: 2500,
    }),
    2n * 10n ** 16n,
  );
  assert.throws(() =>
    limitMinimum({ side: "buy", asset: "TERA", amount: "1", limit: "1", decimalsOut: 18 }),
  );
});

test("the swap is prepared with the tighter of the owner's slippage and the limit", () => {
  // Quote 1000, limit needs 980: 2% of room, owner allows 1% → 1%.
  assert.deepEqual(slippageForLimit(1000n, 980n, 100), {
    ok: true,
    bps: 100,
    tight: false,
    reason: "",
  });
  // Limit needs 995: only 0.5% of room → 50 bps.
  assert.equal(slippageForLimit(1000n, 995n, 100).bps, 50);
  // Quote barely above the limit: 0.1% is the floor, and the owner is told.
  assert.deepEqual(slippageForLimit(100000n, 99995n, 100), {
    ok: true,
    bps: 10,
    tight: true,
    reason: "",
  });
  // Quote already worse than the limit: refused.
  const refused = slippageForLimit(970n, 980n, 100);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /moved back past your limit/);
});

test("only a ready order fills, and a receipt replaces the quote once", () => {
  let list = evaluate([order()], { SPCX: 390 }, NOW).orders;
  const id = list[0].id;
  assert.equal(fillOrder([order()], order().id, { hash }).ok, false);
  const filled = fillOrder(list, id, {
    hash,
    spent: "100",
    received: "0.256",
    estimated: true,
    now: NOW,
  });
  assert.ok(filled.ok);
  list = filled.orders;
  assert.equal(list[0].status, "filled");
  assert.equal(fillOrder(list, id, { hash }).ok, false);
  list = recordFill(list, id, hash, "0.2551");
  list = recordFill(list, id, hash, "9"); // a second read changes nothing
  assert.equal(list[0].fill.received, "0.2551");
  assert.equal(list[0].fill.estimated, undefined);
  // Cancelling a filled order does nothing.
  assert.equal(cancelOrder(list, id)[0].status, "filled");
});

test("stored orders are cleaned, sorted, and capped by live orders", () => {
  const ready = evaluate([order()], { SPCX: 1 }, NOW).orders[0];
  const open = order({ asset: "TERA" });
  const eth = order({ asset: "ETH" });
  const cancelled = cancelOrder([eth], eth.id)[0];
  assert.equal(cancelled.status, "cancelled");
  const cleaned = cleanOrders([open, ready, ready, { ...open, id: "x", side: "hold" }, null]);
  assert.equal(cleaned.length, 2);
  assert.deepEqual(
    sortedOrders([cancelled, open, ready]).map((o) => o.status),
    ["ready", "open", "cancelled"],
  );
  let list = [];
  for (let i = 0; i < LIMITS.maxOrders; i += 1)
    list = saveOrder(list, { ...order(), id: `id${i}` }).orders;
  const full = saveOrder(list, { ...order(), id: "extra" });
  assert.equal(full.ok, false);
  assert.match(full.reason, /up to 30 open orders/);
  // A finished order makes room.
  list = cancelOrder(list, "id0");
  const roomy = saveOrder(list, { ...order(), id: "extra" });
  assert.ok(roomy.ok);
  assert.equal(roomy.orders.length, LIMITS.maxOrders);
  assert.equal(
    roomy.orders.some((o) => o.id === "id0"),
    false,
  );
});

test("a stop-loss sells at or below its price; a take-profit at or above", async () => {
  const { protect, describeOrder: describe } =
    await import("../../public/tera/core/limit-orders.js");
  const made = protect([], {
    asset: "TERA",
    amount: "1000",
    stop: "0.36",
    take: "0.60",
    expiry: "never",
    price: 0.45,
    now: NOW,
  });
  assert.ok(made.ok, made.reason);
  const [stop, take] = made.created;
  assert.equal(stop.kind, "stop");
  assert.equal(stop.side, "sell");
  assert.equal(take.kind, "take");
  assert.equal(stop.linked, take.id);
  assert.equal(take.linked, stop.id);
  assert.equal(meetsLimit(stop, 0.36), true);
  assert.equal(meetsLimit(stop, 0.37), false);
  assert.equal(meetsLimit(take, 0.6), true);
  assert.equal(meetsLimit(take, 0.59), false);
  assert.equal(describe(stop), "Stop-loss: sell 1000 TERA if it falls to $0.36");
  assert.equal(describe(take), "Take-profit: sell 1000 TERA if it rises to $0.60");
  // A stop or take-profit is always a sell, whatever the form said.
  assert.equal(
    parseOrder({ kind: "stop", side: "buy", asset: "TERA", amount: "1", limit: "1", expiry: "day" })
      .order.side,
    "sell",
  );
});

test("whichever linked order becomes ready first cancels the other", async () => {
  const { protect } = await import("../../public/tera/core/limit-orders.js");
  let list = protect([], {
    asset: "TERA",
    amount: "1000",
    stop: "0.36",
    take: "0.60",
    expiry: "never",
    price: 0.45,
    now: NOW,
  }).orders;
  let result = evaluate(list, { TERA: 0.35 }, NOW + 1);
  assert.deepEqual(
    result.ready.map((o) => o.kind),
    ["stop"],
  );
  assert.match(readyText(result.ready[0]), /TERA fell to your \$0.36 stop-loss \(now \$0.35\)/);
  assert.deepEqual(
    result.cancelledLinked.map((o) => o.kind),
    ["take"],
  );
  list = result.orders;
  // The price recovers past the target: the cancelled take-profit stays cancelled.
  result = evaluate(list, { TERA: 0.7 }, NOW + 2);
  assert.deepEqual(result.ready, []);
  assert.deepEqual(
    result.orders.map((o) => [o.kind, o.status]),
    [
      ["stop", "ready"],
      ["take", "cancelled"],
    ],
  );
  // An unlinked stop is left alone by another order becoming ready.
  const lone = parseOrder(
    { kind: "stop", asset: "SPCX", amount: "1", limit: "300", expiry: "never" },
    { now: NOW },
  ).order;
  const other = order({ side: "sell", amount: "1", limit: "500" });
  result = evaluate([lone, other], { SPCX: 510 }, NOW + 3);
  assert.equal(result.orders[0].status, "open");
  assert.equal(result.orders[1].status, "ready");
});

test("protect refuses levels that would fire at once or cross", async () => {
  const { protect } = await import("../../public/tera/core/limit-orders.js");
  const base = { asset: "TERA", amount: "10", expiry: "week", price: 0.45, now: NOW };
  assert.match(protect([], { ...base }).reason, /Set a stop-loss/);
  assert.match(protect([], { ...base, stop: "0.5" }).reason, /below today's price/);
  assert.match(protect([], { ...base, take: "0.4" }).reason, /above today's price/);
  assert.match(
    protect([], { ...base, stop: "0.6", take: "0.5", price: undefined }).reason,
    /below the take-profit/,
  );
  const single = protect([], { ...base, stop: "0.40" });
  assert.ok(single.ok);
  assert.equal(single.created.length, 1);
  assert.equal(single.created[0].linked, undefined);
});

test("suggested levels are measured from the average cost, else today's price", async () => {
  const { suggestLevels } = await import("../../public/tera/core/limit-orders.js");
  assert.deepEqual(suggestLevels({ average: 0.4, price: 0.5 }), {
    stop: "0.36",
    take: "0.48",
    from: "cost",
  });
  assert.deepEqual(suggestLevels({ average: null, price: 400 }), {
    stop: "360",
    take: "480",
    from: "price",
  });
  assert.deepEqual(suggestLevels({ price: 0.000012345 }), {
    stop: "0.00001111",
    take: "0.00001481",
    from: "price",
  });
  assert.deepEqual(suggestLevels({}), { stop: "", take: "", from: "none" });
});
