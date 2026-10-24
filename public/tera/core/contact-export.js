// Moving saved contacts to another device.
//
// A contact (contacts.js) is written into this device's own encrypted data
// and, by contacts.js's own rule, never sent to Tera. Moving it to another
// device has to go through the owner's hands, not Tera's service, so this is
// a file: encrypted under a password the owner picks for the file itself
// (android/src/contact-export.ts does the encrypting, with the same PBKDF2 +
// AES-GCM the wallet's own vault uses), which the owner saves, sends however
// they like, and opens on the other device.
//
// This module owns the file's shape and the rule for bringing its contents
// into a book that already has some. It does not touch a key or a cipher
// itself -- the same discipline contacts.js keeps, extended to a format that
// crosses devices.

import { cleanBook, normaliseAddress, saveContact } from "./contacts.js";

/** The outer, unencrypted envelope every exported file starts as. */
export const FORMAT = { v: 1, kind: "tera-contacts-export" };

const HEX = /^[0-9a-f]+$/;

/** The payload to encrypt: the book, as of now. */
export function buildPayload(book, now = Date.now()) {
  return { contacts: cleanBook(book), exportedAt: now };
}

/**
 * Check a file's outer envelope before any attempt to decrypt it.
 * Returns `{ ok, envelope, reason }`; the salt, nonce and data are exactly
 * what was in the file, still hex, for the caller's own decryption step.
 */
export function parseEnvelope(raw) {
  let obj;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, envelope: null, reason: "Not a valid export file." };
  }
  if (!obj || typeof obj !== "object")
    return { ok: false, envelope: null, reason: "Not a valid export file." };
  if (obj.v !== FORMAT.v || obj.kind !== FORMAT.kind)
    return { ok: false, envelope: null, reason: "Not a Tera contacts export file." };
  for (const field of ["salt", "nonce", "data"])
    if (typeof obj[field] !== "string" || !HEX.test(obj[field]))
      return { ok: false, envelope: null, reason: "Not a valid export file." };
  return { ok: true, envelope: { salt: obj.salt, nonce: obj.nonce, data: obj.data }, reason: "" };
}

/** Check a file's decrypted contents. Returns `{ ok, contacts, reason }`. */
export function parsePayload(decrypted) {
  let obj;
  try {
    obj = JSON.parse(decrypted);
  } catch {
    return { ok: false, contacts: [], reason: "Wrong password, or a corrupted file." };
  }
  if (!obj || !Array.isArray(obj.contacts))
    return { ok: false, contacts: [], reason: "Wrong password, or a corrupted file." };
  return { ok: true, contacts: cleanBook(obj.contacts), reason: "" };
}

/**
 * Bring imported contacts into a book that may already hold some.
 *
 * An address already saved locally is left alone -- an import does not
 * overwrite an edit the owner made since. Everything else goes through
 * `saveContact`, so a name clash or the owner's own address is skipped for
 * the same reason it would be refused when typed by hand.
 *
 * Returns `{ book, added, skipped }`; the book passed in is not changed.
 */
export function mergeImported(book, imported, { owner = "" } = {}) {
  let next = cleanBook(book);
  const self = normaliseAddress(owner);
  const added = [];
  const skipped = [];
  for (const entry of cleanBook(imported)) {
    if (next.some((existing) => existing.address === entry.address) || entry.address === self) {
      skipped.push(entry);
      continue;
    }
    const result = saveContact(next, {
      address: entry.address,
      name: entry.name,
      owner,
      now: entry.savedAt || Date.now(),
    });
    if (result.ok) {
      next = result.book;
      added.push(entry);
    } else {
      skipped.push(entry);
    }
  }
  return { book: next, added, skipped };
}
