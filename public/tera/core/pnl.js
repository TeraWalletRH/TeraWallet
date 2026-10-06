// Profit and loss, and the portfolio's real value over time.
//
// Both are worked out on the device from two public sources: the wallet's own
// transfers, read back from the chain, and the price history Tera serves for its
// charts. Nothing about the owner's positions is sent anywhere.
//
// Cost is average cost. Buying adds the units and what they cost; selling or
// sending removes units at the average cost so far. A sale — units leaving in
// the same transaction that other assets arrive — realises the difference
// between what came back and the cost of what left. A plain send realises
// nothing: giving something away is not a sale.
//
// Where a figure comes from decides how it is labelled:
//
//   Paid in USDG, the cost is exact: a dollar is a dollar.
//   Paid in anything else, or received from someone, the cost is the market
//   price that day — an estimate, and marked as one.
//   With no price for that day, the cost is unknown. An unknown cost is never
//   treated as zero: that token is left out of the totals and named instead,
//   the same rule the wallet's total value follows.
//
// The owner can set their own average cost for any token, for coins bought
// before this wallet or somewhere it cannot see. Their figure replaces the
// computed one and is labelled as theirs.
//
// The chart: the portfolio's value at each moment is what it held then times
// the price then. What it held then is today's balance with every later
// transfer undone. A token with no price for part of the range is left out of
// the whole line rather than dropping in and out of it, and is named.
// Network fees paid in ETH are not transfers, so ETH held in the past reads
// slightly low by the fees paid since.

/** Assets whose dollar value is their amount. */
export const STABLE = ["USDG"];
const isStable = (symbol) => STABLE.includes(symbol);

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** How far from a moment a price may be and still stand for it, per chart range. */
export const RANGES = {
  "1D": { days: 1, gap: 2 * HOUR },
  "1W": { days: 7, gap: 12 * HOUR },
  "1M": { days: 30, gap: 2 * DAY },
  "1Y": { days: 365, gap: 4 * DAY },
};

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Group transfer legs into transactions, oldest first.
 *
 * A leg is `{ hash, timestamp, symbol, amount, direction }` with `direction`
 * "in" or "out" from the owner's side. Legs of the same asset in one
 * transaction are netted, so a refund inside a swap is not a second trade.
 */
export function groupEvents(legs) {
  const byHash = new Map();
  for (const leg of legs || []) {
    if (!leg?.hash || !leg.symbol || !Number.isFinite(leg.timestamp)) continue;
    const amount = num(leg.amount);
    if (amount <= 0) continue;
    const event = byHash.get(leg.hash) || { hash: leg.hash, timestamp: leg.timestamp, net: {} };
    event.timestamp = Math.min(event.timestamp, leg.timestamp);
    event.net[leg.symbol] =
      (event.net[leg.symbol] || 0) + (leg.direction === "in" ? amount : -amount);
    byHash.set(leg.hash, event);
  }
  return [...byHash.values()]
    .map((event) => ({
      hash: event.hash,
      timestamp: event.timestamp,
      ins: Object.entries(event.net)
        .filter(([, amount]) => amount > 0)
        .map(([symbol, amount]) => ({ symbol, amount })),
      outs: Object.entries(event.net)
        .filter(([, amount]) => amount < 0)
        .map(([symbol, amount]) => ({ symbol, amount: -amount })),
    }))
    .filter((event) => event.ins.length || event.outs.length)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * The price nearest to `t` in a `[{ t, p }]` series, or null when the nearest
 * point is further away than `maxGap` or there is none.
 */
export function priceNear(series, t, maxGap) {
  if (!Array.isArray(series) || !series.length) return null;
  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (series[mid].t < t) low = mid + 1;
    else high = mid;
  }
  let best = null;
  for (const index of [low - 1, low]) {
    const point = series[index];
    if (!point || !Number.isFinite(point.p) || point.p <= 0) continue;
    const gap = Math.abs(point.t - t);
    if (gap <= maxGap && (!best || gap < best.gap)) best = { p: point.p, gap };
  }
  return best ? best.p : null;
}

/**
 * Average-cost positions from the wallet's history.
 *
 * `priceAt(symbol, t)` returns a dollar price or null. Returns
 * `{ [symbol]: { qty, cost, realized, unknownCost, estimated, realizedUnknown, realizedEstimated, short } }`.
 */
export function positions(events, priceAt) {
  const book = {};
  const at = (symbol) =>
    (book[symbol] ||= {
      qty: 0,
      cost: 0,
      realized: 0,
      unknownCost: false,
      estimated: false,
      realizedUnknown: false,
      realizedEstimated: false,
      short: false,
    });
  // A leg's dollar value at the event: exact for a stable, estimated otherwise.
  const worth = (leg, t) => {
    if (isStable(leg.symbol)) return { value: leg.amount, exact: true };
    const price = priceAt(leg.symbol, t);
    return price === null
      ? { value: null, exact: false }
      : { value: leg.amount * price, exact: false };
  };
  const total = (values) =>
    values.some((v) => v.value === null)
      ? { value: null, exact: false }
      : { value: values.reduce((sum, v) => sum + v.value, 0), exact: values.every((v) => v.exact) };

  for (const event of events) {
    const paid = total(event.outs.map((leg) => worth(leg, event.timestamp)));
    const received = total(event.ins.map((leg) => worth(leg, event.timestamp)));
    const trade = event.ins.length > 0 && event.outs.length > 0;
    // A trade has one dollar value, used for both what left and what arrived, so
    // two market prices that disagree cannot invent a gain. A stable side is
    // exact and wins; otherwise what was paid; failing that, what came back.
    const value = !trade
      ? null
      : paid.exact && paid.value !== null
        ? paid
        : received.exact && received.value !== null
          ? received
          : paid.value !== null
            ? paid
            : received;
    // A leg's share of the trade, by its market value among its own side.
    const shareOf = (leg, side, sideTotal) => {
      if (side.length === 1) return 1;
      const own = worth(leg, event.timestamp);
      return own.value !== null && sideTotal.value ? own.value / sideTotal.value : null;
    };

    for (const leg of event.outs) {
      if (isStable(leg.symbol)) continue;
      const pos = at(leg.symbol);
      const qty = Math.min(leg.amount, pos.qty);
      if (leg.amount > pos.qty * (1 + 1e-9)) pos.short = true;
      const average = pos.qty > 0 ? pos.cost / pos.qty : 0;
      const removed = average * qty;
      if (trade) {
        const share = shareOf(leg, event.outs, paid);
        if (value.value === null || share === null || pos.unknownCost || pos.short)
          pos.realizedUnknown = true;
        else {
          pos.realized += value.value * share - removed;
          if (!value.exact || pos.estimated) pos.realizedEstimated = true;
        }
      }
      pos.qty -= qty;
      pos.cost -= removed;
      if (pos.qty <= 1e-12) {
        pos.qty = 0;
        pos.cost = 0;
      }
    }

    for (const leg of event.ins) {
      if (isStable(leg.symbol)) continue;
      const pos = at(leg.symbol);
      let cost = null;
      let exact = false;
      if (trade && value.value !== null) {
        const share = shareOf(leg, event.ins, received);
        if (share !== null) {
          cost = value.value * share;
          exact = value.exact;
        }
      }
      // Received from someone, or a trade that could not be valued: the market price that day.
      if (cost === null) cost = worth(leg, event.timestamp).value;
      pos.qty += leg.amount;
      if (cost === null) pos.unknownCost = true;
      else {
        pos.cost += cost;
        if (!exact) pos.estimated = true;
      }
    }
  }
  return book;
}

/**
 * Profit and loss per held token, and in total.
 *
 * `holdings` is today's balance by symbol (numbers), `prices` today's dollar
 * prices, `overrides` the owner's own average costs by symbol (strings).
 * Stables are left out: their value is their cost.
 */
export function summarise({ book, holdings, prices, overrides = {} }) {
  const rows = [];
  const symbols = new Set([
    ...Object.keys(holdings || {}).filter((s) => num(holdings[s]) > 0),
    ...Object.keys(book || {}).filter(
      (s) => Math.abs(book[s].realized) >= 0.005 || book[s].realizedUnknown,
    ),
  ]);
  let unrealized = 0;
  let costBasis = 0;
  let value = 0;
  let realized = 0;
  let anyEstimate = false;
  const unknown = [];
  for (const symbol of symbols) {
    if (isStable(symbol)) continue;
    const pos = book?.[symbol];
    const qty = num(holdings?.[symbol]);
    const price = Number.isFinite(prices?.[symbol]) && prices[symbol] > 0 ? prices[symbol] : null;
    const manual = num(overrides?.[symbol]) > 0 ? num(overrides[symbol]) : null;
    // History explains today's balance only if it has seen at least as many units
    // arrive; holding more than it saw means some units' cost is unknown.
    const explained = pos && pos.qty >= qty * 0.99;
    let average = null;
    let source = "unknown";
    if (manual !== null) {
      average = manual;
      source = "manual";
    } else if (pos && !pos.unknownCost && !pos.short && explained && pos.qty > 0) {
      average = pos.cost / pos.qty;
      source = pos.estimated ? "estimated" : "exact";
    }
    const row = {
      symbol,
      qty,
      price,
      average,
      source,
      costBasis: average === null ? null : average * qty,
      value: price === null ? null : price * qty,
      unrealized: null,
      percent: null,
      realized: pos && !pos.realizedUnknown ? pos.realized : null,
      realizedEstimated: Boolean(pos?.realizedEstimated),
    };
    if (qty > 0 && row.costBasis !== null && row.value !== null) {
      row.unrealized = row.value - row.costBasis;
      row.percent = row.costBasis > 0 ? (row.unrealized / row.costBasis) * 100 : null;
      unrealized += row.unrealized;
      costBasis += row.costBasis;
      value += row.value;
      if (source === "estimated") anyEstimate = true;
    } else if (qty > 0) unknown.push(symbol);
    if (row.realized !== null) {
      realized += row.realized;
      if (row.realizedEstimated) anyEstimate = true;
    }
    rows.push(row);
  }
  rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.symbol.localeCompare(b.symbol));
  return {
    rows,
    total: {
      unrealized,
      costBasis,
      value,
      percent: costBasis > 0 ? (unrealized / costBasis) * 100 : null,
      realized,
      estimated: anyEstimate,
      unknown,
    },
  };
}

/**
 * The portfolio's value over a range, from what it held at each moment and the
 * price at that moment.
 *
 * `holdings` today's balance by symbol, `events` from `groupEvents`, `series`
 * price history by symbol (`[{ t, p }]`, oldest first). Returns
 * `{ points: [{ t, p }], excluded: [symbol] }`.
 */
export function portfolioSeries({
  holdings,
  events,
  series,
  range = "1D",
  now = Date.now(),
  steps = 48,
}) {
  const spec = RANGES[range] || RANGES["1D"];
  const start = now - spec.days * DAY;
  const times = Array.from({ length: steps + 1 }, (_, i) => start + ((now - start) * i) / steps);
  const symbols = Object.keys(holdings || {});
  // Every symbol held at any moment in range, with its balance at each moment.
  const later = [...(events || [])]
    .filter((e) => e.timestamp > start)
    .sort((a, b) => b.timestamp - a.timestamp);
  const balances = {};
  const all = new Set(symbols);
  for (const event of later) for (const leg of [...event.ins, ...event.outs]) all.add(leg.symbol);
  for (const symbol of all) {
    balances[symbol] = times.map((t) => {
      let balance = num(holdings?.[symbol]);
      for (const event of later) {
        if (event.timestamp <= t) break;
        for (const leg of event.ins) if (leg.symbol === symbol) balance -= leg.amount;
        for (const leg of event.outs) if (leg.symbol === symbol) balance += leg.amount;
      }
      return Math.max(0, balance);
    });
  }
  // A token held in range needs a price at every moment it was held.
  const included = [];
  const excluded = [];
  for (const symbol of all) {
    if (!balances[symbol].some((b) => b > 0)) continue;
    if (isStable(symbol)) {
      included.push(symbol);
      continue;
    }
    const covered = times.every(
      (t, i) => balances[symbol][i] <= 0 || priceNear(series?.[symbol], t, spec.gap) !== null,
    );
    (covered ? included : excluded).push(symbol);
  }
  const points = times.map((t, i) => ({
    t,
    p: included.reduce((sum, symbol) => {
      const balance = balances[symbol][i];
      if (balance <= 0) return sum;
      const price = isStable(symbol) ? 1 : priceNear(series[symbol], t, spec.gap);
      return sum + balance * price;
    }, 0),
  }));
  return { points: included.length ? points : [], excluded: excluded.sort() };
}

/** "+$42.10 (+18.4%)" style pieces, without currency formatting. */
export function sign(value) {
  // Under half a cent is no gain or loss, only rounding.
  if (Math.abs(value) < 0.005) return "";
  return value > 0 ? "+" : "−";
}
