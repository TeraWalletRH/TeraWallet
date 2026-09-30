// Spending limits: caps, in dollars, on what this wallet pays out through Tera.
//
// Three optional caps — one payment, one day, one calendar month — checked
// before a payment reaches the review screen and again before it is signed.
// A payment that would cross one is stopped with the figures that stopped it.
//
// Tightening a limit is immediate. Loosening one — raising it or removing it —
// asks for the wallet's password or biometrics again, because the moment a
// limit matters most is the moment someone is pressing to lift it.
//
// What a limit is not, stated plainly because it is easy to assume: a lock on
// the money. The limits live in this app, with this wallet's data. They stop a
// payment made here. Anyone holding the recovery phrase can move the funds
// with any other wallet, and a limit set on one device is not on another.

import { dollarsToUnits, spentBetween, startOfDay, startOfMonth, unitsToAmount } from "./spend.js";

export const KINDS = ["perPayment", "daily", "monthly"];

const positive = (value) => {
  const text = String(value ?? "");
  return /^\d+$/.test(text) && BigInt(text) > 0n ? text : null;
};

/** Limits as stored: USDG base units as strings, or null for no cap. */
export function clean(input) {
  const limits = {};
  for (const kind of KINDS) limits[kind] = positive(input?.[kind]);
  return limits;
}

export const hasAny = (limits) => KINDS.some((kind) => clean(limits)[kind] !== null);

/** Limits from what was typed, in dollars; a blank field is no cap. */
export function fromDollars(fields) {
  const limits = {};
  for (const kind of KINDS) {
    const text = String(fields?.[kind] ?? "").trim();
    if (!text) {
      limits[kind] = null;
      continue;
    }
    const units = dollarsToUnits(text);
    if (units === null)
      return { ok: false, kind, reason: "Enter dollars and cents, or leave it blank." };
    limits[kind] = units.toString();
  }
  const { perPayment, daily, monthly } = limits;
  if (perPayment && daily && BigInt(perPayment) > BigInt(daily))
    return {
      ok: false,
      kind: "perPayment",
      reason: "One payment can't be allowed more than a whole day.",
    };
  if (daily && monthly && BigInt(daily) > BigInt(monthly))
    return {
      ok: false,
      kind: "daily",
      reason: "One day can't be allowed more than a whole month.",
    };
  return { ok: true, limits };
}

/** Stored limits as the text for the form's fields. */
export function toDollars(limits) {
  const fields = {};
  const tidy = clean(limits);
  for (const kind of KINDS) fields[kind] = tidy[kind] ? unitsToAmount(BigInt(tidy[kind])) : "";
  return fields;
}

/** True when `next` raises or removes any cap `before` had. */
export function loosens(before, next) {
  const a = clean(before);
  const b = clean(next);
  return KINDS.some(
    (kind) => a[kind] !== null && (b[kind] === null || BigInt(b[kind]) > BigInt(a[kind])),
  );
}

/** What has been paid today and this month. */
export function usage(rows, now = Date.now()) {
  return {
    today: spentBetween(rows, startOfDay(now), now).units,
    month: spentBetween(rows, startOfMonth(now), now).units,
  };
}

/** How much more each cap allows now; null where there is no cap. */
export function remaining(limits, rows, now = Date.now()) {
  const tidy = clean(limits);
  const used = usage(rows, now);
  const left = (cap, spent) =>
    cap === null ? null : BigInt(cap) > spent ? BigInt(cap) - spent : 0n;
  return {
    perPayment: tidy.perPayment === null ? null : BigInt(tidy.perPayment),
    daily: left(tidy.daily, used.today),
    monthly: left(tidy.monthly, used.month),
  };
}

/**
 * Whether a payment of `amount` (USDG base units, i.e. dollars) fits. `amount`
 * null means its dollar value is unknown: with any cap set that is a refusal,
 * since a limit that waves through what it cannot measure is not a limit.
 */
export function check({ limits, amount, rows, now = Date.now() }) {
  const tidy = clean(limits);
  if (!hasAny(tidy)) return { ok: true };
  if (amount === null || amount === undefined) return { ok: false, kind: "unpriced" };
  const value = BigInt(amount);
  if (tidy.perPayment !== null && value > BigInt(tidy.perPayment))
    return {
      ok: false,
      kind: "perPayment",
      limit: BigInt(tidy.perPayment),
      used: 0n,
      after: value,
    };
  const used = usage(rows, now);
  if (tidy.daily !== null && used.today + value > BigInt(tidy.daily))
    return {
      ok: false,
      kind: "daily",
      limit: BigInt(tidy.daily),
      used: used.today,
      after: used.today + value,
    };
  if (tidy.monthly !== null && used.month + value > BigInt(tidy.monthly))
    return {
      ok: false,
      kind: "monthly",
      limit: BigInt(tidy.monthly),
      used: used.month,
      after: used.month + value,
    };
  return { ok: true };
}
