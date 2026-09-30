// Notes: a line the owner writes on a transaction — "rent for May",
// "invoice 1042". Kept by transaction hash.
//
// A note is private and local, like a contact name: it is sealed into the
// owner's encrypted data on this device and never sent to Tera or written on
// chain. In Tera Business the note is the same one the Reports screen keeps
// beside a transaction's category, so either screen shows what the other wrote.
//
// A note is the owner's words, never a check. It is shown as their own text,
// set apart from anything the chain says about the transaction.

export const LIMITS = { maxLength: 140, maxNotes: 2000 };

// Control characters, zero-width characters, bidi embeddings and overrides,
// and the byte order mark — the same set contact names are cleaned of.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;
const HASH = /^0x[0-9a-f]{64}$/;

/** A note as it is kept: invisible characters out, spaces collapsed, trimmed, capped. */
export function cleanNote(text) {
  return String(text ?? "")
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.maxLength)
    .trim();
}

/** The key a note is kept under: the lowercase hash, or "" when it is not one. */
export const keyFor = (hash) => {
  const key = String(hash ?? "").trim().toLowerCase();
  return HASH.test(key) ? key : "";
};

/** The note on a transaction, or "". */
export function noteFor(notes, hash) {
  const key = keyFor(hash);
  return (key && notes && typeof notes === "object" && typeof notes[key] === "string" && notes[key]) || "";
}

/**
 * The notes with one set, changed or — given an empty text — removed. The map
 * passed in is not changed. Past the cap, the oldest notes written go first.
 */
export function setNote(notes, hash, text) {
  const key = keyFor(hash);
  /** @type {Record<string, string>} */
  const next = { ...(notes || {}) };
  if (!key) return next;
  delete next[key];
  const note = cleanNote(text);
  if (note) next[key] = note;
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - LIMITS.maxNotes))) delete next[old];
  return next;
}

/** Notes as read back from storage: only real hashes and clean, non-empty text. */
export function cleanNotes(notes) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!notes || typeof notes !== "object") return out;
  for (const [hash, text] of Object.entries(notes)) {
    const key = keyFor(hash);
    const note = cleanNote(text);
    if (key && note) out[key] = note;
  }
  const keys = Object.keys(out);
  for (const old of keys.slice(0, Math.max(0, keys.length - LIMITS.maxNotes))) delete out[old];
  return out;
}

/** What the note editor says about where a note is kept. */
export const PRIVACY_NOTE =
  "Notes are saved only on this device, inside your encrypted wallet data. They are not sent to Tera and are not written on chain.";
