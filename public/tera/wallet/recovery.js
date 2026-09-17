// Moving a vault to a second device, and getting back into one when the wallet
// that opens it is gone.
//
// Two separate things live here:
//
//   An export bundle is the vault's contents encrypted under a passphrase the
//   owner types. It is how the same owner carries their drafts, presets and
//   records to another browser. Whoever has the file and the passphrase has the
//   contents; the passphrase is the whole protection, so it has to be a good one.
//
//   A recovery set is the same contents encrypted under a random key, with that
//   key split into shares. Any `threshold` shares rebuild it.
//
// Neither is a way to recover the wallet itself. They recover what this browser
// stored, nothing more. And the share holders are people: any `threshold` of
// them, acting together, open the vault without the owner. Nothing here stops
// that, detects it, or tells the owner it happened.

import { bytesToBase64, base64ToBytes, KDF_ITERATIONS } from "./vault.js";
import { split, combine } from "./shamir.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const EXPORT_FORMAT = "tera-vault-export-v1";
export const RECOVERY_FORMAT = "tera-vault-recovery-v1";
export const SHARE_PREFIX = "TERA-R1";
export const MIN_PASSPHRASE = 12;

/** A transcription check, so a mistyped share fails loudly rather than silently. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const toUrlSafe = (value) => value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromUrlSafe = (value) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return padded + "=".repeat((4 - (padded.length % 4)) % 4);
};

async function passphraseKey(passphrase, salt, iterations, usage) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

export function passphraseIssue(passphrase) {
  const value = String(passphrase ?? "");
  if (value.length < MIN_PASSPHRASE)
    return `Use at least ${MIN_PASSPHRASE} characters. This passphrase is the only thing protecting the file.`;
  if (/^\d+$/.test(value)) return "Digits alone are guessed quickly. Add words.";
  return "";
}

/**
 * Encrypt the vault contents under a passphrase, for carrying to another
 * device. The salt and iteration count travel with the file because the other
 * device needs them; neither is secret.
 */
export async function exportBundle(payload, passphrase, options = {}) {
  const issue = passphraseIssue(passphrase);
  if (issue) throw new Error(issue);
  const iterations = options.iterations || KDF_ITERATIONS;
  const salt = options.salt || crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passphraseKey(passphrase, salt, iterations, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    note: "Tera vault export. Whoever has this file and its passphrase can read its contents. It does not contain a private key and cannot move funds.",
  };
}

export async function importBundle(bundle, passphrase) {
  if (bundle?.format !== EXPORT_FORMAT) throw new Error("This is not a Tera vault export file.");
  if (!bundle.salt || !bundle.iv || !bundle.ciphertext || !Number.isInteger(bundle.iterations))
    throw new Error("This export file is incomplete.");
  const key = await passphraseKey(
    String(passphrase ?? ""),
    base64ToBytes(bundle.salt),
    bundle.iterations,
    ["decrypt"],
  );
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(bundle.iv) },
      key,
      base64ToBytes(bundle.ciphertext),
    );
  } catch {
    // AES-GCM fails the same way for a wrong passphrase and for a tampered
    // file, and this cannot tell them apart. It does not guess.
    throw new Error("That passphrase did not open this file, or the file has been altered.");
  }
  return JSON.parse(decoder.decode(plaintext));
}

/** One share, as a string the owner can write down or send. */
export function encodeShare(share) {
  const body = new Uint8Array(share.y.length + 1);
  body[0] = share.x;
  body.set(share.y, 1);
  const checksum = crc32(body).toString(16).padStart(8, "0");
  return `${SHARE_PREFIX}.${share.threshold}.${share.shares}.${toUrlSafe(bytesToBase64(body))}.${checksum}`;
}

export function decodeShare(value) {
  const parts = String(value ?? "")
    .trim()
    .split(".");
  if (parts.length !== 5 || parts[0] !== SHARE_PREFIX)
    throw new Error("That is not a Tera recovery share.");
  const threshold = Number(parts[1]);
  const shares = Number(parts[2]);
  if (!Number.isInteger(threshold) || !Number.isInteger(shares) || threshold < 2)
    throw new Error("That share does not say how many are needed.");
  let body;
  try {
    body = base64ToBytes(fromUrlSafe(parts[3]));
  } catch {
    throw new Error("That share is not readable. Check it was copied in full.");
  }
  if (body.length < 2) throw new Error("That share is too short to be valid.");
  if (crc32(body).toString(16).padStart(8, "0") !== parts[4])
    throw new Error("That share failed its checksum. A character is wrong or missing.");
  return { x: body[0], y: body.slice(1), threshold, shares };
}

/**
 * Encrypt the vault contents under a fresh random key and split that key.
 * Returns the blob to keep and the shares to hand out. The key itself is never
 * returned or stored: after this call it exists only inside the shares.
 */
export async function createRecovery(payload, { shares = 3, threshold = 2 } = {}) {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", secret, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  const pieces = split(secret, { shares, threshold });
  secret.fill(0);
  return {
    blob: {
      format: RECOVERY_FORMAT,
      createdAt: new Date().toISOString(),
      threshold,
      shares,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      note: `Tera vault recovery. Any ${threshold} of the ${shares} shares will open this file. Holding it without enough shares reveals nothing.`,
    },
    shares: pieces.map(encodeShare),
  };
}

export async function recoverFromShares(blob, shareStrings) {
  if (blob?.format !== RECOVERY_FORMAT) throw new Error("This is not a Tera recovery file.");
  const decoded = shareStrings.map(decodeShare);
  const threshold = blob.threshold || decoded[0]?.threshold || 2;
  if (decoded.length < threshold)
    throw new Error(`This file needs ${threshold} shares. You have supplied ${decoded.length}.`);
  const secret = combine(decoded.slice(0, threshold));
  const key = await crypto.subtle.importKey("raw", secret, { name: "AES-GCM" }, false, ["decrypt"]);
  secret.fill(0);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(blob.iv) },
      key,
      base64ToBytes(blob.ciphertext),
    );
  } catch {
    throw new Error("Those shares did not open this file. They may belong to a different one.");
  }
  return JSON.parse(decoder.decode(plaintext));
}
