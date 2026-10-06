// Watched wallets: an address the owner follows without holding its key.
//
// A cold wallet, a business treasury, a parent's account. The owner sees what
// it holds and what moved, read from the chain like anything else, and nothing
// more: Tera has no key for it, so no screen that shows one may offer to send,
// swap, bridge or sign from it. That is the one rule that matters here, and it
// is enforced where the screen is built, not by a flag someone could forget —
// a watched wallet is never the account the app signs with.
//
// What it holds is never counted as the owner's. The home total is the
// owner's own wallets; anything watched is stated separately and named as
// watched.
//
// The list is private and local. It is written into the owner's encrypted data
// on this device and is never sent to Tera. Reading a watched wallet's balance
// does ask the network about that address, the same as reading the owner's
// own — and the privacy note says so.

import { normaliseAddress, parseName } from "./contacts.js";

/** The published limits, quoted in the form and in the tests. */
export const LIMITS = { maxWatched: 20 };

export { normaliseAddress };

/** Keep only well-formed entries. What a stored list means, whatever it held. */
export function cleanWatched(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const address = normaliseAddress(entry?.address);
    const name = parseName(entry?.name);
    if (!address || !name.ok || seen.has(address)) continue;
    seen.add(address);
    out.push({
      address,
      name: name.name,
      tag: typeof entry?.tag === "string" && /^[a-z0-9_]{1,32}$/.test(entry.tag) ? entry.tag : "",
      addedAt: Number.isSafeInteger(entry?.addedAt) ? entry.addedAt : 0,
    });
    if (out.length >= LIMITS.maxWatched) break;
  }
  return out;
}

/**
 * Start watching an address, or rename one already watched.
 *
 * Returns `{ ok, list, entry, reason }`; the list passed in is not changed.
 * `own` is every address this wallet holds a key for: those are already the
 * owner's, and watching one would show the same money twice.
 *
 * @param {any[] | undefined} list
 * @param {{ address: string, name: string, tag?: string, own?: string[], now?: number }} input
 * @returns {{ ok: boolean, list: any[], entry: any, reason: string }}
 */
export function watch(list, { address, name, tag = "", own = [], now = Date.now() }) {
  const current = cleanWatched(list);
  const fail = (reason) => ({ ok: false, list: current, entry: null, reason });
  const target = normaliseAddress(address);
  if (!target) return fail("Enter a valid Robinhood Chain address.");
  if (own.some((mine) => normaliseAddress(mine) === target))
    return fail("This is one of your own wallets. It is already in your wallet list.");
  const parsed = parseName(name);
  if (!parsed.ok) return fail(parsed.reason);
  const key = parsed.name.toLowerCase().replace(/\s+/g, "");
  const clash = current.find(
    (entry) => entry.address !== target && entry.name.toLowerCase().replace(/\s+/g, "") === key,
  );
  if (clash)
    return fail(`You already watch a wallet called "${clash.name}". Use a different name.`);
  const existing = current.find((entry) => entry.address === target);
  if (!existing && current.length >= LIMITS.maxWatched)
    return fail(`You can watch up to ${LIMITS.maxWatched} wallets. Stop watching one first.`);
  const entry = {
    address: target,
    name: parsed.name,
    tag: /^[a-z0-9_]{1,32}$/.test(String(tag)) ? String(tag) : existing?.tag || "",
    addedAt: existing?.addedAt || now,
  };
  const next = existing
    ? current.map((item) => (item.address === target ? entry : item))
    : [...current, entry];
  return { ok: true, list: next, entry, reason: "" };
}

/** The list without this address. Removing an unknown address is not an error. */
export function unwatch(list, address) {
  const target = normaliseAddress(address);
  return cleanWatched(list).filter((entry) => entry.address !== target);
}

/** The watched entry for an address, or null. */
export function watchedFor(list, address) {
  const target = normaliseAddress(address);
  if (!target) return null;
  return cleanWatched(list).find((entry) => entry.address === target) ?? null;
}

/** Watched wallets sorted by name, for a list the owner scans. */
export const sortedWatched = (list) =>
  [...cleanWatched(list)].sort((a, b) => a.name.localeCompare(b.name));

export const READ_ONLY =
  "Watching only. Tera has no key for this wallet, so nothing can be sent, swapped or signed from it here.";

export const PRIVACY_NOTE =
  "The wallets you watch are kept in your encrypted data on this device and never sent to Tera. Their balances and activity are read from the network the same way your own are, which means the network can see which addresses are asked about.";
