// Stablecoin spending: pay someone a dollar amount, and have it leave as dollars.
//
// A wallet full of ETH and tokenised stocks is not money you can hand to someone
// for a price in dollars — the amount they receive moves while you type it. USDG
// does not, so this is the balance Tera treats as spendable: a payment of $25 is
// 25 USDG, and 25 USDG is what arrives.
//
// When the dollars are not there, the payment is not quietly made out of
// something else. `plan` says how short it is and proposes a top-up: sell enough
// ETH for USDG first, as its own reviewed and signed swap, then pay. Two
// signatures, each one showing what it does — never a swap hidden inside a
// payment.
//
// What this is not: a card, a bank balance, or a promise USDG holds its peg.
// USDG is counted at 1.00 by definition here, the same as in `value.js`.

/** The stablecoin spending is made in. */
export const STABLE = "USDG";
/** USDG's decimals on Robinhood Chain. */
export const DECIMALS = 6;
/**
 * Extra bought on a top-up, in basis points. A swap may deliver as little as 99%
 * of its quote, and the price read here can be a minute old; 2% covers both, and
 * whatever is left over stays in USDG, ready for the next payment.
 */
export const TOP_UP_MARGIN_BPS = 200n;
/** ETH a top-up never sells, so the payment after it can still pay its fee. */
export const GAS_RESERVE_WEI = 500000000000000n; // 0.0005 ETH

const UNIT = 10n ** BigInt(DECIMALS);

/**
 * A typed dollar amount in USDG base units, or null when it is not one.
 * Cents are the smallest step: "$12.345" is not an amount anyone quotes.
 */
export function dollarsToUnits(text) {
  const clean = String(text ?? "")
    .trim()
    .replace(/^\$/, "")
    .replace(/,/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, cents = ""] = clean.split(".");
  const units = BigInt(whole) * UNIT + BigInt(cents.padEnd(2, "0")) * (UNIT / 100n);
  return units > 0n ? units : null;
}

/** USDG base units as dollars, rounded down to the cent: "$1,234.56". */
export function formatDollars(units) {
  const value = BigInt(units ?? 0n);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const cents = abs / (UNIT / 100n);
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** USDG base units as the plain token amount a transfer is prepared with: "12.5". */
export function unitsToAmount(units) {
  const value = BigInt(units);
  const fraction = (value % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${value / UNIT}.${fraction}` : `${value / UNIT}`;
}

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

/**
 * What paying `amount` dollars takes, from what the wallet holds now.
 *
 *   ready   — USDG covers it. Pay.
 *   top-up  — USDG does not, and selling `topUp.wei` of ETH would. Top up, then pay.
 *   short   — neither does, or ETH has no usable price. `reason` says which.
 *   invalid — `amount` is not a dollar amount.
 *
 * `stable` and `eth` are base-unit balances; `ethPrice` is dollars per ETH.
 */
export function plan({ amount, stable, eth, ethPrice }) {
  const units = dollarsToUnits(amount);
  if (units === null) return { state: "invalid" };
  const have = BigInt(stable ?? 0n);
  if (have >= units) return { state: "ready", units };
  const shortfall = units - have;
  if (!(Number.isFinite(ethPrice) && ethPrice > 0))
    return { state: "short", units, shortfall, reason: "no-price" };
  // Dollars per ETH in USDG units, so the rest is integer arithmetic.
  const price = BigInt(Math.floor(ethPrice * Number(UNIT)));
  if (price <= 0n) return { state: "short", units, shortfall, reason: "no-price" };
  const buy = ceilDiv(shortfall * (10000n + TOP_UP_MARGIN_BPS), 10000n);
  const wei = ceilDiv(buy * 10n ** 18n, price);
  const spendable = BigInt(eth ?? 0n) - GAS_RESERVE_WEI;
  if (wei > spendable) return { state: "short", units, shortfall, reason: "not-enough" };
  return { state: "top-up", units, shortfall, topUp: { wei, dollars: buy } };
}

function parseAmount(text) {
  const match = String(text ?? "")
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0n;
  const [whole, fraction = ""] = match[1].split(".");
  return BigInt(whole) * UNIT + BigInt(fraction.slice(0, DECIMALS).padEnd(DECIMALS, "0"));
}

/** Midnight at the start of `now`'s day, local time. */
export const startOfDay = (now = Date.now()) => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
/** The first moment of `now`'s calendar month, local time. */
export const startOfMonth = (now = Date.now()) => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
};

/**
 * Dollars paid out from `start` to `now`, from activity rows:
 *
 *   - a send this device recorded with `spendUsd` — its dollar value when it
 *     was signed, whatever the asset;
 *   - otherwise a USDG send, this device's (`activityAmount` like "12.5 USDG")
 *     or one read from the chain (`direction` "send", `symbol` USDG).
 *
 * Failed transactions paid nothing and are left out. Swaps and bridges are not
 * payments and are not counted. It is a count of this wallet's history, not a
 * statement — a non-USDG send made on another device is not in it.
 */
export function spentBetween(rows, start, now = Date.now()) {
  let units = 0n;
  let count = 0;
  for (const row of rows || []) {
    const at = Number(row?.createdAt ?? row?.timestamp ?? 0);
    if (!(at >= start && at <= now)) continue;
    if (row.status === "failed" || row.status === "reverted") continue;
    let amount = 0n;
    if (row.activityType === "send" && /^\d+$/.test(String(row.spendUsd ?? "")))
      amount = BigInt(row.spendUsd);
    else if (row.activityType === "send" && /\bUSDG$/.test(String(row.activityAmount || "").trim()))
      amount = parseAmount(row.activityAmount);
    else if (row.direction === "send" && String(row.symbol).toUpperCase() === STABLE)
      amount = parseAmount(row.amount);
    if (amount > 0n) {
      units += amount;
      count += 1;
    }
  }
  return { units, count };
}

/** Dollars paid out this calendar month. See `spentBetween`. */
export const spentThisMonth = (rows, now = Date.now()) =>
  spentBetween(rows, startOfMonth(now), now);
