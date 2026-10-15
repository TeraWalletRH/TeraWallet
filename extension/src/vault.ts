// The wallet in this browser: one secret (a recovery phrase or a private
// key), sealed with the owner's password exactly as the web app seals it, in
// the extension's own storage. The address is kept beside it in the clear so
// connected sites can be answered without asking for the password each time;
// the secret itself is only opened with the password, to check it or to sign
// one approved request, and is never kept.

import { open, seal, walletFromSecret, type Box } from "../../android/src/crypto";
import { PASSWORD_ITERATIONS, passwordKey } from "../../android/src/kdf.web";

export type Vault = { v: 1; kdf: number; salt: string; box: Box; address: string };

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (text: string) => Uint8Array.from(text.match(/../g) || [], (b) => parseInt(b, 16));

export const MIN_PASSWORD = 6;

/** Seal `secret` under `password`. Throws with a readable message if either is unusable. */
export async function createVault(secret: string, password: string): Promise<Vault> {
  if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  const account = walletFromSecret(secret.trim());
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await passwordKey(password, salt, PASSWORD_ITERATIONS);
  const box = seal(key, secret.trim(), crypto.getRandomValues(new Uint8Array(12)));
  return { v: 1, kdf: PASSWORD_ITERATIONS, salt: hex(salt), box, address: account.address };
}

/**
 * The secret, when `password` opens the vault and the secret still derives its
 * address; otherwise null. Callers use it at once and keep no copy.
 */
export async function openSecret(vault: Vault, password: string): Promise<string | null> {
  try {
    const key = await passwordKey(password, unhex(vault.salt), vault.kdf);
    const secret = open(key, vault.box);
    return walletFromSecret(secret).address === vault.address ? secret : null;
  } catch {
    return null;
  }
}

/** The account that signs with `secret`. */
export const signer = (secret: string) => walletFromSecret(secret);
