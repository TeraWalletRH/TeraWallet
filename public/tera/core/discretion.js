/**
 * What the screen shows, and what it holds back.
 *
 * Two settings that both reduce what is on display, for two unrelated reasons.
 * Hiding small balances is about clutter: a wallet that lists eleven dust
 * positions above the two that matter is harder to read than one that does
 * not. Privacy mode is about the person standing behind you.
 *
 * Neither changes what the wallet holds, what it will sign, or what it
 * reports. Only what is drawn.
 *
 * Three rules the rest of the app depends on:
 *
 *   Nothing is hidden silently. A balance held back is still counted in the
 *   total and still reported as a count, because a wallet that quietly stops
 *   mentioning something its owner owns is wrong about what they own.
 *
 *   A holding with no price is never small. Not knowing what something is
 *   worth is not evidence that it is worth little, and an asset nobody has
 *   priced yet is exactly the one it would be worst to hide by accident.
 *
 *   Privacy mode never covers the figure being authorised. It exists so a
 *   glance over the shoulder does not read a balance; standing between an
 *   owner and the amount they are about to send would make it a hazard
 *   rather than a convenience.
 */

/** Below this, in the owner's display currency, a holding counts as small. */
export const DEFAULT_THRESHOLD = 1;

/**
 * What covers a concealed figure.
 *
 * Fixed width rather than one mark per digit: a mask that grows with the
 * number tells a bystander the size of what it is hiding.
 */
export const MASK = "••••••";

/**
 * Screens where a figure is never concealed, whatever privacy mode says.
 *
 * These are the places an owner is checking a number in order to act on it.
 * A hidden amount there is not privacy, it is a wallet asking someone to
 * approve something it will not show them.
 */
export const ALWAYS_SHOWN = ["review", "sign", "receipt", "limit"];

/** Whether a figure shown in this context may be concealed at all. */
export function concealable(context) {
  return !ALWAYS_SHOWN.includes(String(context ?? ""));
}

/**
 * A figure for display, concealed or not.
 *
 * `context` is the screen it appears on; anything in ALWAYS_SHOWN is returned
 * untouched however the setting is left.
 */
export function conceal(text, { on = false, context = "" } = {}) {
  return on && concealable(context) ? MASK : text;
}

/**
 * Split holdings into the ones shown and the ones held back.
 *
 * `rows` is `[{ symbol, amount, value }]`, `value` being what core/value.js
 * made of it — null when it could not be priced. The return carries the
 * hidden rows themselves, not just a count, so a surface can offer to show
 * them rather than only admit they exist.
 */
export function partitionSmall(rows = [], { on = false, threshold = DEFAULT_THRESHOLD } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const limit = Number(threshold);
  const live = on && Number.isFinite(limit) && limit > 0;
  if (!live) return { shown: list, hidden: [], hiddenValue: null };

  const shown = [];
  const hidden = [];
  for (const row of list) {
    const raw = row?.value;
    const value = Number(raw);
    // Unpriced stays visible. See the note at the top of this file. The null
    // check is not redundant: Number(null) is 0, so coercing first would read
    // "nobody could price this" as "this is worth nothing" and hide exactly
    // the holding that must not be hidden.
    if (raw === null || raw === undefined || raw === "" || !Number.isFinite(value)) {
      shown.push(row);
      continue;
    }
    (value < limit ? hidden : shown).push(row);
  }
  return {
    shown,
    hidden,
    // Null rather than 0 when nothing was hidden, so a surface renders an
    // empty slot rather than a confident "$0.00" worth of nothing.
    hiddenValue: hidden.length
      ? hidden.reduce((sum, row) => sum + Number(row.value), 0)
      : null,
  };
}

/**
 * What to tell an owner about what is missing from the list in front of them.
 *
 * Returns "" when nothing is hidden, so a surface can render this
 * unconditionally and get silence when there is nothing to say.
 */
export function hiddenNote(hidden = [], { formatted = "" } = {}) {
  const count = Array.isArray(hidden) ? hidden.length : 0;
  if (!count) return "";
  const assets = count === 1 ? "1 small balance" : `${count} small balances`;
  return formatted ? `${assets} hidden, worth ${formatted}` : `${assets} hidden`;
}
