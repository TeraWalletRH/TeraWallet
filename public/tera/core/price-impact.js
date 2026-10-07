// Price impact: how much a swap moves the price against the owner by its own
// size. Slippage guards against the price moving after the quote; impact is the
// loss already inside the quote, because the pool is thin for this amount. The
// slippage limit cannot catch it, so the review states it, and past certain
// levels asks for consent or refuses.
//
// The quote's figure compares this trade's rate with the rate for one unit of
// the same input. A trade smaller than one unit can come out slightly negative;
// that is no impact, and is shown as none.
//
// The levels, each one a test:
//
//   Under 1%: stated, nothing more.
//   From 1%: stated as a warning, with what it costs in dollars.
//   From 5%: signing waits until the owner confirms they accept the loss.
//   From 15%: refused. The pool is too thin for this size; a smaller trade, or
//   several, is suggested instead. The same line Uniswap's own interface draws.

export const LEVELS = { warn: 1, confirm: 5, block: 15 };

/**
 * What a quote's impact means for this trade.
 *
 * `pct` is the quote's `priceImpactPct` (percent: 2.4 means 2.4%). `inputUsd` is
 * the dollar value of what is being swapped, or null when it cannot be priced.
 * Returns `{ level, pct, costUsd }`, where `level` is "unknown", "low", "warn",
 * "confirm" or "blocked".
 *
 * @param {number | null | undefined} pct
 * @param {number | null | undefined} [inputUsd]
 */
export function assess(pct, inputUsd = null) {
  if (typeof pct !== "number" || !Number.isFinite(pct))
    return { level: "unknown", pct: null, costUsd: null };
  const impact = Math.max(0, pct);
  const costUsd =
    typeof inputUsd === "number" && Number.isFinite(inputUsd) && inputUsd > 0
      ? (inputUsd * impact) / 100
      : null;
  const level =
    impact >= LEVELS.block
      ? "blocked"
      : impact >= LEVELS.confirm
        ? "confirm"
        : impact >= LEVELS.warn
          ? "warn"
          : "low";
  return { level, pct: impact, costUsd };
}

/** "2.4%" — two decimals under 1%, one above. */
export const formatPct = (pct) => `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%`;

/** "≈ $12.30", or "" when the trade has no dollar value. */
const cost = (usd) => (usd === null ? "" : ` (≈ $${usd < 0.01 ? "0.01" : usd.toFixed(2)})`);

/** The review row's value. */
export function rowText(assessment) {
  if (assessment.level === "unknown") return "Not available for this route";
  return `${formatPct(assessment.pct)}${cost(assessment.costUsd)}`;
}

/** The sentence under the row, or "" when nothing needs saying. */
export function message(assessment) {
  switch (assessment.level) {
    case "warn":
      return `This trade moves the price about ${formatPct(assessment.pct)} against you${cost(assessment.costUsd)}.`;
    case "confirm":
      return `High price impact: you lose about ${formatPct(assessment.pct)}${cost(assessment.costUsd)} to the size of this trade. A smaller amount would lose less.`;
    case "blocked":
      return `Price impact is ${formatPct(assessment.pct)}: the pool is too thin for this amount. Try a smaller trade, or split it into several.`;
    default:
      return "";
  }
}

/** The consent the owner ticks before signing a high-impact trade. */
export function consentText(assessment) {
  return `I understand I'll lose about ${formatPct(assessment.pct)}${cost(assessment.costUsd)} to price impact.`;
}
