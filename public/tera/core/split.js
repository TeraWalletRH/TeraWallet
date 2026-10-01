// Split a bill: one total, shared between people, collected as payment requests.
//
// The owner paid for dinner — $120 — and four friends owe their share. This
// module works out the shares; the app then makes one payment request link
// per person (core/pay-links.js) and follows each one until it is paid.
//
// Money is counted in USDG base units (cents and below), never in floats.
// An even split that does not divide exactly gives the leftover cents to the
// first people on the list, one each, so the shares always add up to the
// total — nobody is asked for a fraction of a cent, and nothing goes missing.
//
// The owner's own share, when they are in on it, is never requested: they
// already paid it. A split is the owner's record, kept in their encrypted data
// like a contact; the names in it are their labels, not anyone's identity.

export const LIMITS = { maxPeople: 20, maxName: 40, maxTitle: 60 };

const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

/** A name or title as kept: invisible characters out, spaces collapsed, capped. */
export function cleanText(text, max) {
  return String(text ?? "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/**
 * Even shares of `total` (base units) between `people`, with the owner as one
 * more share when `includeMe`. Returns { shares: bigint[] (one per person),
 * mine: bigint }. The first people take the leftover units, one each.
 */
export function splitEvenly(total, people, includeMe = false) {
  const amount = BigInt(total);
  const count = BigInt(people + (includeMe ? 1 : 0));
  if (people < 1 || amount <= 0n) return { shares: [], mine: 0n };
  const base = amount / count;
  let left = amount - base * count;
  const shares = [];
  for (let i = 0; i < people; i++) {
    const extra = left > 0n ? 1n : 0n;
    left -= extra;
    shares.push(base + extra);
  }
  // Whatever is still left over is the owner's: they are last in line.
  return { shares, mine: includeMe ? base + left : 0n };
}

/**
 * Check a split before any request is made. `shares` are base units, one per
 * person. Returns { ok, reason, mine } — `mine` is what the owner covers.
 * Reasons: "title", "total", "people", "too-many", "name", "same-name",
 * "share", "over".
 */
export function check({ title, total, names, shares, includeMe = false }) {
  const amount = BigInt(total ?? 0);
  if (!cleanText(title, LIMITS.maxTitle)) return { ok: false, reason: "title" };
  if (amount <= 0n) return { ok: false, reason: "total" };
  if (!names.length) return { ok: false, reason: "people" };
  if (names.length > LIMITS.maxPeople) return { ok: false, reason: "too-many" };
  const seen = new Set();
  for (const name of names) {
    const clean = cleanText(name, LIMITS.maxName);
    if (!clean) return { ok: false, reason: "name" };
    const key = clean.toLowerCase();
    if (seen.has(key)) return { ok: false, reason: "same-name", name: clean };
    seen.add(key);
  }
  if (shares.length !== names.length || shares.some((s) => BigInt(s) <= 0n)) return { ok: false, reason: "share" };
  const asked = shares.reduce((sum, s) => sum + BigInt(s), 0n);
  if (asked > amount) return { ok: false, reason: "over" };
  // Without the owner in, the shares must cover the whole bill.
  if (!includeMe && asked !== amount) return { ok: false, reason: "short", missing: amount - asked };
  return { ok: true, mine: amount - asked };
}

/** The note a person's request carries: "Dinner at Nobu · Ada's share". */
export const requestNote = (title, name) =>
  cleanText(`${cleanText(title, LIMITS.maxTitle)} · ${cleanText(name, LIMITS.maxName)}'s share`, 140);

/**
 * Where a split stands, from the status of each person's link.
 * `status` maps a link id to "open", "paid" or "cancelled"; a share whose link
 * is unknown counts as open. Returns { paid, open, cancelled, collected, owed }.
 */
export function progress(split, status = {}) {
  const out = { paid: 0, open: 0, cancelled: 0, collected: 0n, owed: 0n };
  for (const share of split?.shares || []) {
    const state = status[share.linkId] || "open";
    if (state === "paid") {
      out.paid++;
      out.collected += BigInt(share.amount);
    } else if (state === "cancelled") out.cancelled++;
    else {
      out.open++;
      out.owed += BigInt(share.amount);
    }
  }
  return out;
}

/** Splits as read back from storage: well-formed entries only, newest first, at most 100. */
export function cleanSplits(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (s) =>
        s &&
        typeof s.id === "string" &&
        Array.isArray(s.shares) &&
        s.shares.every((x) => x && typeof x.linkId === "string" && /^\d+$/.test(String(x.amount))),
    )
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 100);
}
