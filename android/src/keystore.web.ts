// Where the sealed wallet and its data file live in a browser.
//
// This site's own storage, on this device. Nothing here is sent anywhere, and
// nothing here is readable without the PIN: the wallet is sealed before it
// reaches this file, exactly as on a phone. What a browser lacks is a keychain
// guarding that sealed copy, which is why kdf.web.ts spends more rounds.
//
// No biometrics: a browser cannot hold a key behind Face ID the way the phone's
// keychain does, so the web build offers the PIN only.

// Two vaults can live side by side: the personal wallet, and a Tera Business
// wallet with its own secret, PIN and data. Only one is open at a time, and
// which one was last used is remembered so a reload opens the same door.
// Personal keeps the original prefix, so a wallet created before business
// mode existed is exactly where it always was.
export type VaultKind = "personal" | "business";
const MODE = "tera.web.mode";
const prefixes: Record<VaultKind, string> = {
  personal: "tera.web.",
  business: "tera.web.business.",
};
let kind: VaultKind = "personal";
try {
  if (localStorage.getItem(MODE) === "business") kind = "business";
} catch {
  // Storage blocked: open the personal vault, as before business mode existed.
}
let PREFIX = prefixes[kind];

export const vaultKind = () => kind;

/** Point every read and write below at the other vault. Lock the wallet first. */
export function useVault(next: VaultKind) {
  kind = next;
  PREFIX = prefixes[next];
  try {
    localStorage.setItem(MODE, next);
  } catch {
    // Not remembered across a reload, which only means the next visit opens personal.
  }
}

// Ask once for storage the browser will not clear to make room. An installed
// app usually gets it; a tab may not, and the recovery phrase is the answer then.
try {
  void navigator.storage?.persist?.();
} catch {}

export const biometricsSupported = false;
export const biometricsReady = async () => false;

export async function secureGet(key: string, _prompt?: string) {
  return localStorage.getItem(PREFIX + key);
}

export async function secureSet(key: string, value: string, prompt?: string) {
  if (prompt) throw new Error("Biometric unlock is not available here. / 此处不支持生物识别解锁。");
  localStorage.setItem(PREFIX + key, value);
}

export async function secureDelete(key: string) {
  localStorage.removeItem(PREFIX + key);
}

export async function readFile(name: string) {
  return localStorage.getItem(`${PREFIX}file.${name}`);
}

export async function writeFile(name: string, text: string) {
  localStorage.setItem(`${PREFIX}file.${name}`, text);
}

export async function deleteFile(name: string) {
  localStorage.removeItem(`${PREFIX}file.${name}`);
}
