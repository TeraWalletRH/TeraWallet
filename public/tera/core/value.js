// What a holding is worth, and how much of that answer is actually known.
//
// Every wallet shows a number at the top of the screen. Most of them get it by sending
// the list of tokens you hold to a price API, which is a fair description of your
// portfolio handed to a company you have no relationship with. Tera's price request is
// not that: `/api/assets/prices` returns the price of every asset in the registry and
// carries nothing — no address, no balances, no session. It is the identical request
// whoever makes it, so it cannot tell one owner from another, and the multiplication
// happens here, on the device, against balances that never leave.
//
// That is the privacy half, and it was the easy half. The hard half is arithmetic
// honesty, because a total is the most trusted number in a wallet and the easiest one to
// quietly get wrong:
//
//   A price that could not be read is not a price of zero. Treating it as one produces a
//   total that looks complete, is confidently wrong, and is wrong in the direction that
//   makes someone feel poorer than they are — or, if they are deciding whether a transfer
//   leaves them enough, in the direction that matters. This module never sums an unpriced
//   holding. It counts it, names it, and makes the caller say so.
//
//   `coverage` exists so a surface cannot render the number without the caveat. It is the
//   same idea as the fourth state in `verdict.js`: a total that could not be established
//   is not a total, and a field that says so beside the figure is what stops the figure
//   overclaiming.
//
// What a figure from here is not, in the order people assume it:
//
//   It is not an offer. Nothing in this wallet can be sold at this price, and no part of
//   this calculation asked whether anyone would buy.
//
//   It is not a quote for your size. The RWA prices behind it are derived from an
//   on-chain swap route for one unit. A holding large enough to move that route is worth
//   less than this says, and the thinner the route the further off it is.
//
//   It is a USDG valuation wearing a dollar sign. USDG is priced at 1.00 by definition
//   here, not by observation.

/** Every holding priced. The only case where a bare figure is honest. */
export const COMPLETE = "complete";
/** Some holding could not be priced. The figure is a subtotal and must be labelled one. */
export const PARTIAL = "partial";
/** Nothing could be priced. There is no figure. */
export const NONE = "none";

/**
 * Where each price comes from, which is worth showing because the answers differ.
 *
 * The RWA line is the interesting one: those prices are read from the chain's own
 * liquidity rather than bought from a market data vendor, so the number has the same
 * provenance as the transaction it is describing.
 */
export const PRICE_SOURCES = [
  {
    id: "stable",
    label: "USDG",
    detail: "Pinned to 1.00. That is a definition, not a measurement.",
  },
  {
    id: "rwa",
    label: "Tokenised assets",
    detail:
      "Derived from an on-chain swap route to USDG for one unit. It is the chain's own liquidity, read the same way a transaction would read it — not a price bought from a market data vendor.",
  },
  {
    id: "eth",
    label: "ETH",
    detail:
      "The one price with an outside source: a public market API, with a second one and then an on-chain route as fallbacks. Tera makes that request from its own server, at most twice a minute for everybody at once, so the party answering it never learns that you exist.",
  },
];

const amountOf = (value) => {
  // Balances arrive as decimal strings, already formatted to the asset's precision by the
  // surface that read them. Parsed here rather than trusted: a malformed balance must not
  // become a NaN that propagates silently into a total.
  //
  // The empty check is not defensive padding. `Number("")` is 0, so without it a balance
  // that was never read — undefined, null, an empty cell — would value as zero and be
  // counted as a holding worth nothing, which is the exact failure this module exists to
  // prevent, arriving from the other side.
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const rateOf = (price) =>
  typeof price === "number" && Number.isFinite(price) && price >= 0 ? price : null;

const priceOf = (prices, symbol) => rateOf(prices?.[symbol]);

/**
 * Value one holding, or null when it cannot be valued.
 *
 * Null rather than zero, everywhere, for the reason at the top of this file.
 */
export function valueOf(amount, price) {
  const units = amountOf(amount);
  const rate = rateOf(price);
  return units === null || rate === null ? null : units * rate;
}

/**
 * The total, and everything a surface needs to describe how partial it is.
 *
 * `holdings` is `[{ symbol, amount }]`, `amount` being a decimal string in the asset's
 * own units. `prices` is the map `/api/assets/prices` returns, keyed by symbol.
 *
 * A holding of zero that has no price is not counted as unpriced. It would contribute
 * nothing to the total either way, and reporting it as a gap would make an owner go
 * looking for a missing figure that does not exist.
 */
export function totalValue(holdings = [], prices = {}) {
  const priced = [];
  const unpriced = [];
  let total = 0;

  for (const holding of holdings) {
    const symbol = holding?.symbol || "";
    const units = amountOf(holding?.amount);
    const price = priceOf(prices, symbol);
    if (units === null) continue;
    if (price === null) {
      if (units > 0) unpriced.push({ symbol, amount: holding.amount });
      continue;
    }
    total += units * price;
    priced.push({ symbol, amount: holding.amount, value: units * price });
  }

  const coverage = !priced.length ? NONE : unpriced.length ? PARTIAL : COMPLETE;
  return {
    coverage,
    // Null rather than 0 when nothing could be priced, so a surface that forgets to read
    // `coverage` renders an empty slot rather than a confident "$0.00".
    total: coverage === NONE ? null : total,
    priced,
    unpriced,
  };
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The sentence that goes under the figure.
 *
 * Written here rather than at each surface for the same reason `report.js` exists: three
 * places drawing the same result is three chances for one of them to describe it more
 * kindly, and the kind version is the one people would read.
 */
export function summarise(result = {}, { asOf = "" } = {}) {
  const read = asOf ? ` Prices read ${asOf}.` : "";
  if (result.coverage === NONE)
    return "No prices could be read, so nothing here is valued. Your balances are unaffected — they are read from the chain, not from a price.";
  if (result.coverage === PARTIAL)
    return `A subtotal. ${plural(result.unpriced.length, "holding has", "holdings have")} no price — ${result.unpriced
      .map((entry) => entry.symbol)
      .join(
        ", ",
      )} — and ${result.unpriced.length === 1 ? "it is" : "they are"} left out rather than counted as nothing.${read}`;
  return `All ${plural(result.priced.length, "holding", "holdings")} valued.${read}`;
}

/** A figure for display. Never returns "0.00" for an absent total. */
export function format(value, { currency = "USD" } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

/** What a valuation does not establish, for the panel that offers one. */
export const LIMITS = [
  "It is not an offer. Nothing here was asked whether it would buy at this price, and a figure on a screen has never moved an asset.",
  "It is not a quote for your size. Tokenised assets are priced from an on-chain route for one unit, so a holding large enough to move that route is worth less than this says — and the thinner the route, the further off it is.",
  "USDG is priced at 1.00 by definition rather than by observation, so this is a USDG valuation displayed with a dollar sign.",
  "A price that could not be read is left out of the total, never counted as zero. When that happens the figure is labelled a subtotal and the missing holdings are named.",
  "The price request carries no address, no balances and no session — it is the same request for every owner, and the multiplication happens on this device. Your holdings are not sent anywhere to be valued.",
];
