// The wallet in this browser: one secret (a recovery phrase or a private
// key), sealed with the owner's password exactly as the web app seals it, in
// the extension's own storage. The address is kept beside it in the clear so
// connected sites can be answered without asking for the password each time;
// the secret itself is only opened with the password, to check it or to sign
// one approved request, and is never kept.

import { getAddress, isAddress } from "viem";
import { open, seal, walletFromSecret, type Box } from "../../android/src/crypto";
import { PASSWORD_ITERATIONS, passwordKey } from "../../android/src/kdf.web";

export type SealedVault = { v: 1; kdf: number; salt: string; box: Box; address: string };
/**
 * A wallet that's only watched: an address and nothing else. Balances and
 * activity read as usual; anything that needs the key is refused.
 */
export type WatchVault = { v: 1; watch: true; address: string };
export type Vault = SealedVault | WatchVault;

export const isWatch = (vault: Vault | null | undefined): vault is WatchVault =>
  Boolean(vault && "watch" in vault && vault.watch);

/** What a watch-only wallet says when asked to sign. */
export const WATCH_ONLY =
  "This is a watch-only wallet. Tera can't send or sign for it. Bring in its recovery phrase or key to do that.";

/** Watch `address`. Throws with a readable message if it isn't one. */
export function watchVault(address: string): WatchVault {
  const text = address.trim();
  if (!isAddress(text, { strict: false }) || /^0x0{40}$/i.test(text))
    throw new Error(
      "That isn't a wallet address. It starts with 0x and has 40 letters and numbers.",
    );
  return { v: 1, watch: true, address: getAddress(text) };
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (text: string) => Uint8Array.from(text.match(/../g) || [], (b) => parseInt(b, 16));

export const MIN_PASSWORD = 8;

/** Seal `secret` under `password`. Throws with a readable message if either is unusable. */
export async function createVault(secret: string, password: string): Promise<SealedVault> {
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
  if (isWatch(vault)) return null;
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
