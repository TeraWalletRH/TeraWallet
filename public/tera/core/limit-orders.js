// Limit orders: buy or sell when the price reaches a level the owner chose.
//
// Tera never holds the owner's key, so an order cannot fill itself while they
// are away. An order is a watch on the price plus a swap written out in advance:
// when the price reaches the target, the order becomes ready and the owner is
// told. Executing it opens the swap screen filled in, and the swap's minimum
// output is set from the owner's limit price — not only from their slippage
// setting — so if the price has moved back past the limit by the time they
// sign, the swap reverts on chain instead of filling at a worse price.
//
// Prices are in US dollars, the same figures the wallet shows. Most pairs trade
// against USDG, where a dollar limit is exact. TERA trades against ETH, so its
// dollar limit is turned into an ETH amount with the ETH price read when the
// owner signs; the screen says so.
//
// The rules, each one a test:
//
//   A buy is ready when the price is at or below the limit; a sell when it is at
//   or above. Once touched, an order stays ready: a price that came and went
//   while the app was closed is reported, not forgotten, and the limit is still
//   enforced when the owner signs.
//
//   An order past its expiry is expired, ready or not.
//
//   The minimum output never asks for less than the limit allows, to within the
//   0.1% the smallest slippage setting can express.
//
// Three kinds share these rules:
//
//   A limit order buys at or below its price, or sells at or above it.
//   A take-profit sells at or above its price — a sell limit by its proper name,
//   enforced on chain the same way.
//   A stop-loss sells at or below its price, to cap a loss. Its price is not
//   enforced on chain, and cannot usefully be: a stop fires because the price is
//   falling, so a swap that insisted on the stop price would revert exactly when
//   it is needed. Its minimum comes from the live quote and the owner's slippage
//   limit, and the screen says how far below the stop the price now is.
//
// A stop-loss and a take-profit set together on one holding are linked: when
// either becomes ready, the other is cancelled, so the same tokens are never
// offered for sale twice.
//
// Nothing sells on its own. A stop is only as quick as the owner's tap after
// they are told, and the screens say so.
//
// Orders are kept in the owner's encrypted data on this device and never sent
// to Tera.

/** The published limits, quoted in the form and in the tests. */
export const LIMITS = { maxOrders: 30 };

/** How long an order waits. Days, or null for no expiry. */
export const EXPIRIES = {
  day: { label: "1 day", days: 1 },
  week: { label: "1 week", days: 7 },
  month: { label: "1 month", days: 30 },
  never: { label: "Until cancelled", days: null },
};

/** What an order does when its price is reached. */
export const KINDS = ["limit", "stop", "take"];

/** What a trade in `asset` is paired with: ETH for TERA, USDG for everything else. */
export const pairFor = (asset) => (asset === "TERA" ? "ETH" : "USDG");

const AMOUNT = /^\d+(\.\d+)?$/;
const SYMBOL = /^[A-Za-z0-9.]{1,12}$/;
const HASH = /^0x[0-9a-f]{64}$/i;
const STATUSES = ["open", "ready", "filled", "cancelled", "expired"];
const DAY_MS = 86_400_000;
const isAmount = (value) => typeof value === "string" && AMOUNT.test(value) && /[1-9]/.test(value);

/**
 * Read what the owner filled in and return the order to store.
 *
 * `amount` is what a buy spends (in the pair asset) or what a sell sells (in
 * the asset). `limit` is the dollar price that triggers it.
 *
 * @param {Record<string, any>} input
 * @param {{ existing?: any, now?: number }} [options]
 * @returns {{ ok: boolean, order: any, reason: string }}
 */
export function parseOrder(input, { existing = null, now = Date.now() } = {}) {
  const fail = (reason) => ({ ok: false, order: null, reason });
  const kind = KINDS.includes(input?.kind)
    ? input.kind
    : KINDS.includes(existing?.kind)
      ? existing.kind
      : "limit";
  // Stops and take-profits only ever sell what is held.
  const side =
    kind !== "limit"
      ? "sell"
      : input?.side === "sell"
        ? "sell"
        : input?.side === "buy"
          ? "buy"
          : "";
  if (!side) return fail("Choose buy or sell.");
  const asset = String(input?.asset ?? "").trim();
  if (!SYMBOL.test(asset) || asset === "USDG") return fail("Choose a token other than USDG.");
  const amount = String(input?.amount ?? "").trim();
  if (!isAmount(amount)) return fail("Enter an amount above zero.");
  const limit = String(input?.limit ?? "")
    .trim()
    .replace(/^\$/, "");
  if (!isAmount(limit)) return fail("Enter a target price above zero.");
  const expiry = EXPIRIES[input?.expiry] ? input.expiry : "";
  if (!expiry) return fail("Choose when the order expires.");
  const createdAt = existing?.createdAt || now;
  const days = EXPIRIES[expiry].days;
  return {
    ok: true,
    order: {
      id: existing?.id || newId(now),
      kind,
      side,
      asset,
      pair: pairFor(asset),
      amount,
      limit,
      expiry,
      // Editing an order restarts its clock from the edit.
      expiresAt: days === null ? null : (existing ? now : createdAt) + days * DAY_MS,
      status: "open",
      createdAt,
      ...(typeof (input?.linked ?? existing?.linked) === "string" &&
      (input?.linked ?? existing?.linked)
        ? { linked: input?.linked ?? existing?.linked }
        : {}),
    },
    reason: "",
  };
}

const newId = (now) =>
  `o${now.toString(36)}${Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0")}`;

/** Keep only well-formed orders. What a stored list means, whatever it held. */
export function cleanOrders(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) continue;
    const parsed = parseOrder(entry, { existing: entry, now: entry.createdAt || 0 });
    if (!parsed.ok) continue;
    seen.add(entry.id);
    const order = {
      ...parsed.order,
      expiresAt: Number.isSafeInteger(entry.expiresAt) ? entry.expiresAt : null,
      status: STATUSES.includes(entry.status) ? entry.status : "open",
    };
    if (Number.isSafeInteger(entry.readyAt)) order.readyAt = entry.readyAt;
    if (typeof entry.cancelledBy === "string") order.cancelledBy = entry.cancelledBy;
    if (Number.isFinite(entry.readyPrice)) order.readyPrice = entry.readyPrice;
    if (entry.fill && HASH.test(entry.fill.hash))
      order.fill = {
        hash: entry.fill.hash.toLowerCase(),
        at: Number.isSafeInteger(entry.fill.at) ? entry.fill.at : 0,
        ...(isAmount(entry.fill.spent) ? { spent: entry.fill.spent } : {}),
        ...(isAmount(entry.fill.received) ? { received: entry.fill.received } : {}),
        ...(entry.fill.estimated ? { estimated: true } : {}),
      };
    out.push(order);
    if (out.length >= LIMITS.maxOrders) break;
  }
  return out;
}

/** Add or replace an order. Returns `{ ok, orders, reason }`. */
export function saveOrder(orders, order) {
  const current = cleanOrders(orders);
  const exists = current.some((entry) => entry.id === order.id);
  const live = current.filter((entry) => entry.status === "open" || entry.status === "ready");
  if (!exists && live.length >= LIMITS.maxOrders)
    return {
      ok: false,
      orders: current,
      reason: `You can keep up to ${LIMITS.maxOrders} open orders. Cancel one first.`,
    };
  // Finished orders make room: the oldest are dropped before a new one is refused.
  let next = exists
    ? current.map((entry) => (entry.id === order.id ? order : entry))
    : [...current, order];
  while (next.length > LIMITS.maxOrders) {
    const oldest = next.findIndex((entry) => entry.status !== "open" && entry.status !== "ready");
    if (oldest < 0) break;
    next = next.filter((_, index) => index !== oldest);
  }
  return { ok: true, orders: next, reason: "" };
}

/** Whether a price meets an order's limit. */
export function meetsLimit(order, price) {
  if (!Number.isFinite(price) || price <= 0) return false;
  const limit = Number(order.limit);
  if (order.kind === "stop") return price <= limit;
  return order.side === "buy" ? price <= limit : price >= limit;
}

/**
 * Check every live order against the prices the wallet just read.
 *
 * Returns `{ orders, ready, expired, changed }`: the updated list, the orders
 * that became ready now (to announce), the ones that ran out of time, and
 * whether anything changed (so the caller writes only when it must).
 */
export function evaluate(orders, prices, now = Date.now()) {
  /** @type {any[]} */
  const ready = [];
  const expired = [];
  let changed = false;
  const next = cleanOrders(orders).map((order) => {
    if (order.status !== "open" && order.status !== "ready") return order;
    if (order.expiresAt !== null && now >= order.expiresAt) {
      changed = true;
      const done = { ...order, status: "expired" };
      expired.push(done);
      return done;
    }
    if (order.status === "open" && meetsLimit(order, prices?.[order.asset])) {
      changed = true;
      const touched = {
        ...order,
        status: "ready",
        readyAt: now,
        readyPrice: prices[order.asset],
      };
      ready.push(touched);
      return touched;
    }
    return order;
  });
  // A linked pair: the first to become ready cancels the other.
  const readyIds = new Set(ready.map((order) => order.id));
  const cancelledLinked = [];
  const settled = next.map((order) => {
    if (!order.linked || readyIds.has(order.id)) return order;
    if (order.status !== "open" && order.status !== "ready") return order;
    if (!readyIds.has(order.linked)) return order;
    changed = true;
    const done = { ...order, status: "cancelled", cancelledBy: order.linked };
    cancelledLinked.push(done);
    return done;
  });
  // Two linked orders ready on the same read: the stop wins, as it protects capital.
  for (const order of ready) {
    const sibling = settled.find((entry) => entry.id === order.linked);
    if (sibling && sibling.status === "ready" && readyIds.has(sibling.id)) {
      const keep = order.kind === "stop" ? order : sibling;
      const drop = keep === order ? sibling : order;
      const index = settled.findIndex((entry) => entry.id === drop.id);
      settled[index] = { ...drop, status: "cancelled", cancelledBy: keep.id };
      readyIds.delete(drop.id);
    }
  }
  return {
    orders: settled,
    ready: ready.filter((order) => readyIds.has(order.id)),
    expired,
    cancelledLinked,
    changed,
  };
}

/** Cancel an open or ready order. Finished orders are left as they are. */
export function cancelOrder(orders, id) {
  return cleanOrders(orders).map((order) =>
    order.id === id && (order.status === "open" || order.status === "ready")
      ? { ...order, status: "cancelled" }
      : order,
  );
}

/** Remove an order from the list entirely. */
export const removeOrder = (orders, id) => cleanOrders(orders).filter((order) => order.id !== id);

export const orderFor = (orders, id) =>
  cleanOrders(orders).find((order) => order.id === id) ?? null;

/**
 * Mark a ready order filled with its transaction. `received` is the quoted
 * output until `recordFill` replaces it with what the receipt shows.
 */
export function fillOrder(
  orders,
  id,
  { hash, spent = "", received = "", estimated = false, now = Date.now() },
) {
  const current = cleanOrders(orders);
  const order = current.find((entry) => entry.id === id);
  if (!order || order.status !== "ready")
    return { ok: false, orders: current, reason: "That order is not ready to fill." };
  if (!HASH.test(hash)) return { ok: false, orders: current, reason: "Invalid transaction." };
  const fill = { hash: hash.toLowerCase(), at: now };
  if (isAmount(spent)) fill.spent = spent;
  if (isAmount(received)) fill.received = received;
  if (estimated) fill.estimated = true;
  return {
    ok: true,
    orders: current.map((entry) =>
      entry.id === id ? { ...entry, status: "filled", fill } : entry,
    ),
    reason: "",
  };
}

/** Replace a filled order's quoted output with what its receipt delivered. */
export function recordFill(orders, id, hash, received) {
  return cleanOrders(orders).map((order) => {
    if (order.id !== id || !order.fill || order.fill.hash !== String(hash).toLowerCase())
      return order;
    if (!order.fill.estimated || !isAmount(received)) return order;
    const fill = { ...order.fill, received };
    delete fill.estimated;
    return { ...order, fill };
  });
}

// ---- Enforcing the limit on chain -------------------------------------------

const SCALE = 18;

/** A decimal string (or finite number) as an integer scaled by 10^18. */
function scaled(value) {
  const text = typeof value === "number" ? value.toFixed(SCALE) : String(value);
  if (!AMOUNT.test(text)) throw new Error("Invalid amount.");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole + fraction.slice(0, SCALE).padEnd(SCALE, "0"));
}

const ONE = 10n ** BigInt(SCALE);

/**
 * The least output, in the output token's smallest units, that honours the
 * limit price for this trade.
 *
 * `amount` is what is being swapped now (it may differ from the order if the
 * owner changed it), in the input asset. `ethPrice` is the ETH dollar price,
 * needed only for TERA, which trades against ETH.
 *
 * @param {{ side: string, asset: string, amount: string, limit: string, decimalsOut: number, ethPrice?: number }} trade
 */
export function limitMinimum({ side, asset, amount, limit, decimalsOut, ethPrice = 0 }) {
  const amountIn = scaled(amount);
  const price = scaled(limit);
  if (price <= 0n) throw new Error("Invalid limit.");
  const unit = 10n ** BigInt(decimalsOut);
  const viaEth = pairFor(asset) === "ETH";
  const eth = viaEth ? scaled(ethPrice) : ONE;
  if (viaEth && eth <= 0n) throw new Error("The ETH price is needed for a TERA order.");
  // Buy: spend `amount` of the pair, receive at least amount × pairPrice ÷ limit of the asset.
  // Sell: sell `amount` of the asset, receive at least amount × limit ÷ pairPrice of the pair.
  // Rounded up, so the minimum is never below what the limit allows.
  const numerator = side === "buy" ? amountIn * eth * unit : amountIn * price * unit;
  const denominator = side === "buy" ? price * ONE : eth * ONE;
  return (numerator + denominator - 1n) / denominator;
}

/**
 * The slippage, in basis points, to prepare the swap with so its on-chain
 * minimum is no lower than the limit allows.
 *
 * Returns `{ ok, bps, tight, reason }`. `ok` is false when the live quote is
 * already worse than the limit. `tight` is true when the quote is so close to
 * the limit that the smallest slippage (0.1%) allows slightly less than the
 * limit — the owner is told before signing.
 */
export function slippageForLimit(quoteOut, minimumOut, userBps, minBps = 10) {
  const quote = BigInt(quoteOut);
  const minimum = BigInt(minimumOut);
  if (quote <= 0n || quote < minimum)
    return {
      ok: false,
      bps: 0,
      tight: false,
      reason: "The price has moved back past your limit. The order stays ready until it returns.",
    };
  const room = Number(((quote - minimum) * 10_000n) / quote);
  const bps = Math.max(minBps, Math.min(userBps, room));
  return { ok: true, bps, tight: room < minBps, reason: "" };
}

// ---- Presentation -----------------------------------------------------------

/** "Buy TERA with 50 USDG at $0.40 or lower" */
export function describeOrder(order) {
  if (order.kind === "stop")
    return `Stop-loss: sell ${order.amount} ${order.asset} if it falls to $${order.limit}`;
  if (order.kind === "take")
    return `Take-profit: sell ${order.amount} ${order.asset} if it rises to $${order.limit}`;
  return order.side === "buy"
    ? `Buy ${order.asset} with ${order.amount} ${order.pair} at $${order.limit} or lower`
    : `Sell ${order.amount} ${order.asset} at $${order.limit} or higher`;
}

/** The notification when an order becomes ready. */
export function readyText(order) {
  const now = Number.isFinite(order.readyPrice) ? ` (now $${order.readyPrice})` : "";
  if (order.kind === "stop")
    return `${order.asset} fell to your $${order.limit} stop-loss${now}. Your sell is ready to sign.`;
  if (order.kind === "take")
    return `${order.asset} reached your $${order.limit} take-profit${now}. Your sell is ready to sign.`;
  const verb = order.side === "buy" ? "buy" : "sell";
  const price = Number.isFinite(order.readyPrice) ? ` (now $${order.readyPrice})` : "";
  return `${order.asset} reached your $${order.limit} target${price}. Your ${verb} is ready to sign.`;
}

/** Orders for a list the owner scans: ready, then open, then finished, newest first within each. */
export function sortedOrders(orders) {
  const rank = { ready: 0, open: 1, filled: 2, cancelled: 3, expired: 3 };
  return [...cleanOrders(orders)].sort(
    (a, b) => rank[a.status] - rank[b.status] || b.createdAt - a.createdAt,
  );
}

/**
 * Protect a holding with a stop-loss, a take-profit, or both — linked so that
 * whichever becomes ready first cancels the other.
 *
 * `price` is today's price, used to refuse a stop already above it or a target
 * already below it (each would be ready the moment it was placed).
 *
 * @param {any[] | undefined} orders
 * @param {{ asset: string, amount: string, stop?: string, take?: string, expiry: string, price?: number, now?: number }} input
 * @returns {{ ok: boolean, orders: any[], created: any[], reason: string }}
 */
export function protect(
  orders,
  { asset, amount, stop = "", take = "", expiry, price, now = Date.now() },
) {
  const current = cleanOrders(orders);
  const fail = (reason) => ({ ok: false, orders: current, created: [], reason });
  const stopPrice = String(stop).trim().replace(/^\$/, "");
  const takePrice = String(take).trim().replace(/^\$/, "");
  if (!stopPrice && !takePrice) return fail("Set a stop-loss, a take-profit, or both.");
  if (stopPrice && takePrice && Number(stopPrice) >= Number(takePrice))
    return fail("The stop-loss must be below the take-profit.");
  if (Number.isFinite(price) && price > 0) {
    if (stopPrice && Number(stopPrice) >= price)
      return fail("The stop-loss must be below today's price, or it would fire at once.");
    if (takePrice && Number(takePrice) <= price)
      return fail("The take-profit must be above today's price, or it would fire at once.");
  }
  const created = [];
  for (const [kind, limit] of [
    ["stop", stopPrice],
    ["take", takePrice],
  ]) {
    if (!limit) continue;
    const parsed = parseOrder(
      { kind, asset, amount, limit, expiry },
      { now: now + created.length },
    );
    if (!parsed.ok) return fail(parsed.reason);
    created.push(parsed.order);
  }
  if (created.length === 2) {
    created[0].linked = created[1].id;
    created[1].linked = created[0].id;
  }
  let next = current;
  for (const order of created) {
    const saved = saveOrder(next, order);
    if (!saved.ok) return fail(saved.reason);
    next = saved.orders;
  }
  return { ok: true, orders: next, created, reason: "" };
}

/** A price as a short decimal string with four significant digits. */
function roundPrice(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const digits = Math.max(0, 3 - Math.floor(Math.log10(value)));
  const text = value.toFixed(Math.min(digits, 12));
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/**
 * Suggested stop and target: a fixed distance from the owner's average cost
 * when it is known, otherwise from today's price. Returns strings for the form
 * and which figure they were measured from.
 *
 * @param {{ average?: number | null, price?: number | null, down?: number, up?: number }} input
 */
export function suggestLevels({ average = null, price = null, down = 10, up = 20 }) {
  const base = Number.isFinite(average) && average > 0 ? average : price;
  if (!Number.isFinite(base) || base <= 0) return { stop: "", take: "", from: "none" };
  return {
    stop: roundPrice(base * (1 - down / 100)),
    take: roundPrice(base * (1 + up / 100)),
    from: base === average ? "cost" : "price",
  };
}

export const PRIVACY_NOTE =
  "Limit orders are kept in your encrypted data on this device and never sent to Tera. Tera cannot fill them for you: when one is ready, you sign it, and the swap's minimum output is set from your limit price.";
