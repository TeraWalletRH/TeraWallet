// Contacts: a name the owner gives an address they have sent to.
//
// "Mum" is easier to pick than 0x5b27…9f05. That is the whole value, and it is
// also the risk: a name the owner trusts is a name they stop reading past. So
// this module holds the rules that keep a saved name from ever standing in for
// the address it labels, and both surfaces read them from here.
//
// A contact is private and local. It is written into the owner's encrypted
// data on this device — the vault on web, the sealed data file on Android — and
// is never sent to Tera. That is the difference from a tag (`tags.js`): a tag
// is a name Tera's register says an address holds; a contact is a name the
// owner wrote down. Nobody else can see it, change it, or vouch for it.
//
// Four rules, each one a test:
//
//   A name never looks like something else. It may not start with `@`, where
//   it would read as a Tera tag, and it may not contain `0x` followed by hex,
//   where it would read as an address. Invisible and direction-changing
//   characters are removed, so a name cannot hide or reorder text.
//
//   One name, one address. Two saved addresses may not share a name, compared
//   without case or spacing, or "Mum" becomes a coin toss.
//
//   The address is always shown. A contact labels an address; every screen
//   that shows the name shows the full address beside it, and the transfer is
//   built from the address alone.
//
//   Robinhood Chain only. A saved address is an account on this chain. A
//   bridge sends to another chain, where the same address is not the same
//   account, so contacts are not offered there — the same rule as tags.

export const ContactError = class ContactError extends Error {};

/** The published shape of a name, quoted in the save UI and in the tests. */
export const LIMITS = { minLength: 1, maxLength: 32, maxContacts: 200 };

const ADDRESS = /^0x[0-9a-f]{40}$/;

// Control characters, zero-width characters, bidi embeddings and overrides,
// and the byte order mark. None of these is visible, and each one can make a
// name read differently from what is stored.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

/** The canonical form of an address: lowercase, or "" when it is not one. */
export function normaliseAddress(input) {
  const text = String(input ?? "")
    .trim()
    .toLowerCase();
  return ADDRESS.test(text) ? text : "";
}

/** The key two names collide on: no case, no spacing. */
export const nameKey = (name) =>
  String(name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");

/**
 * Read what the owner typed and return the name to store.
 *
 * Returns `{ ok, name, reason }` rather than throwing, because it runs as the
 * owner types. The reason is written to be shown as it is.
 */
export function parseName(input) {
  const name = String(input ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();

  if (name.length < LIMITS.minLength) return { ok: false, name: "", reason: "Enter a name." };
  if (name.length > LIMITS.maxLength)
    return {
      ok: false,
      name: "",
      reason: `A name is at most ${LIMITS.maxLength} characters.`,
    };
  if (name.startsWith("@"))
    return {
      ok: false,
      name: "",
      // A saved name that reads as a tag would claim Tera's register vouched
      // for it. It did not, so the name may not look as if it had.
      reason: "A name cannot start with @. That is how Tera tags are written.",
    };
  if (/0x[0-9a-f]{4,}/i.test(name))
    return {
      ok: false,
      name: "",
      reason: "A name cannot contain an address. The address is shown beside it anyway.",
    };
  return { ok: true, name, reason: "" };
}

/** Keep only well-formed entries. What a stored list means, whatever it held. */
export function cleanBook(list) {
  if (!Array.isArray(list)) return [];
  const seenAddress = new Set();
  const seenName = new Set();
  const book = [];
  for (const entry of list) {
    const address = normaliseAddress(entry?.address);
    const parsed = parseName(entry?.name);
    if (!address || !parsed.ok) continue;
    const key = nameKey(parsed.name);
    if (seenAddress.has(address) || seenName.has(key)) continue;
    seenAddress.add(address);
    seenName.add(key);
    const savedAt = Number.isSafeInteger(entry?.savedAt) ? entry.savedAt : 0;
    book.push({ address, name: parsed.name, savedAt });
    if (book.length >= LIMITS.maxContacts) break;
  }
  return book;
}

/** The saved entry for an address, or null. */
export function contactFor(book, address) {
  const wanted = normaliseAddress(address);
  if (!wanted) return null;
  return cleanBook(book).find((entry) => entry.address === wanted) ?? null;
}

/** The saved name for an address, or "". */
export const nameFor = (book, address) => contactFor(book, address)?.name ?? "";

/**
 * Save a name for an address, or rename one already saved.
 *
 * Returns `{ ok, book, contact, reason }`. The book passed in is not changed.
 * `owner` is the wallet doing the saving: its own address is not a contact.
 */
export function saveContact(book, { address, name, owner = "", now = Date.now() }) {
  const current = cleanBook(book);
  const target = normaliseAddress(address);
  if (!target) return { ok: false, book: current, contact: null, reason: "Enter a valid address." };
  if (target === normaliseAddress(owner))
    return {
      ok: false,
      book: current,
      contact: null,
      reason: "This is your own wallet. It does not need a contact name.",
    };
  const parsed = parseName(name);
  if (!parsed.ok) return { ok: false, book: current, contact: null, reason: parsed.reason };

  const key = nameKey(parsed.name);
  const clash = current.find((entry) => entry.address !== target && nameKey(entry.name) === key);
  if (clash)
    return {
      ok: false,
      book: current,
      contact: null,
      reason: `"${clash.name}" is already the name of ${short(clash.address)}. Use a different name.`,
    };

  const existing = current.find((entry) => entry.address === target);
  if (!existing && current.length >= LIMITS.maxContacts)
    return {
      ok: false,
      book: current,
      contact: null,
      reason: `You can save up to ${LIMITS.maxContacts} addresses. Remove one first.`,
    };

  const contact = { address: target, name: parsed.name, savedAt: existing?.savedAt || now };
  const next = existing
    ? current.map((entry) => (entry.address === target ? contact : entry))
    : [...current, contact];
  return { ok: true, book: next, contact, reason: "" };
}

/** The book without this address. Removing an unknown address is not an error. */
export function removeContact(book, address) {
  const target = normaliseAddress(address);
  return cleanBook(book).filter((entry) => entry.address !== target);
}

/** Saved contacts, sorted by name for a list the owner scans. */
export const sortedContacts = (book) =>
  [...cleanBook(book)].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Addresses the owner has sent to, newest first, with any saved name.
 *
 * Read from the owner's own history: each entry is `{ payee, createdAt }`,
 * where `payee` is the address the owner chose — not the contract a private
 * route deposits into. Entries without a payee are not sends and are skipped.
 */
export function recentPayees(history, book, { owner = "", limit = 8 } = {}) {
  const self = normaliseAddress(owner);
  const saved = cleanBook(book);
  const rows = Array.isArray(history) ? [...history] : [];
  rows.sort((a, b) => (Number(b?.createdAt) || 0) - (Number(a?.createdAt) || 0));
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const address = normaliseAddress(row?.payee);
    if (!address || address === self || seen.has(address)) continue;
    seen.add(address);
    const contact = saved.find((entry) => entry.address === address);
    out.push({ address, name: contact?.name ?? "", lastSentAt: Number(row?.createdAt) || 0 });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Filter saved contacts by what the owner typed: part of a name, or the start
 * of an address. Empty input returns them all.
 */
export function searchContacts(book, query) {
  const all = sortedContacts(book);
  const text = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!text) return all;
  if (/^0x/.test(text)) return all.filter((entry) => entry.address.startsWith(text));
  const key = nameKey(text);
  return all.filter((entry) => nameKey(entry.name).includes(key));
}

/** `0x1234…cdef`. Used in messages; screens show the full address. */
export const short = (address) => {
  const text = String(address ?? "");
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
};

/** Where a saved address may be offered. The bridge stays out, as with tags. */
export const SCOPE = { transfer: true, privateSend: true, bridge: false };

/** What the save screen says about where a name is kept. */
export const PRIVACY_NOTE =
  "Names are saved only on this device, inside your encrypted wallet data. They are not sent to Tera. A name is your label, not a check: read the address before you sign.";
