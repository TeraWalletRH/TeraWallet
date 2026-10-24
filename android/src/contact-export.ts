// Exporting and importing saved contacts between devices.
//
// Encrypted under a password the owner picks for the file itself, not their
// wallet password -- the file may be opened on a device that doesn't have
// this wallet on it at all. Same primitives the wallet's own vault uses
// (crypto.ts): PBKDF2 derives a key from the password and a random salt,
// AES-GCM seals the contacts under it. core/contact-export.js owns the
// file's shape and the merge rules; this file owns getting bytes to and
// from it.

import * as Crypto from "expo-crypto";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { open, passwordKey, PASSWORD_ITERATIONS, seal } from "./crypto";
import {
  FORMAT,
  buildPayload,
  parseEnvelope,
  parsePayload,
} from "../../public/tera/core/contact-export.js";

const random = (n: number) => Crypto.getRandomValues(new Uint8Array(n));

/** The exported file's contents, as a JSON string ready to save or share. */
export async function exportContacts(book: unknown, password: string): Promise<string> {
  if (!password) throw new Error("Enter a password for the export file.");
  const salt = random(16);
  const key = await passwordKey(password, salt, PASSWORD_ITERATIONS);
  try {
    const payload = JSON.stringify(buildPayload(book));
    const box = seal(key, payload, random(12));
    return JSON.stringify({ ...FORMAT, salt: bytesToHex(salt), nonce: box.nonce, data: box.data });
  } finally {
    key.fill(0);
  }
}

/** The contacts inside an exported file. Throws with a message fit to show. */
export async function importContacts(raw: string, password: string) {
  const parsedEnvelope = parseEnvelope(raw);
  if (!parsedEnvelope.ok) throw new Error(parsedEnvelope.reason);
  if (!password) throw new Error("Enter the file's password.");
  const { salt, nonce, data } = parsedEnvelope.envelope!;
  const key = await passwordKey(password, hexToBytes(salt), PASSWORD_ITERATIONS);
  let decrypted: string;
  try {
    decrypted = open(key, { v: 1, nonce, data });
  } catch {
    throw new Error("Wrong password, or a corrupted file.");
  } finally {
    key.fill(0);
  }
  const parsedPayload = parsePayload(decrypted);
  if (!parsedPayload.ok) throw new Error(parsedPayload.reason);
  return parsedPayload.contacts;
}
