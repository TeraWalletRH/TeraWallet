// The encrypted local vault and the lifecycle of the key that opens it.
//
// Version 1 derived one key from one wallet signature, for ever: no rotation,
// no second factor, no way onto a second device, no recovery. Version 2 adds an
// epoch and a random salt to the derivation, so the key can be retired and
// replaced, and runs the material through PBKDF2 so an optional passphrase is
// worth something.
//
// The passphrase protects this browser's copy of the vault. It is not a second
// factor for anything Tera holds, and it never leaves the device.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const CURRENT_VERSION = 2;
// OWASP's floor for PBKDF2-HMAC-SHA256. Raise it, never lower it.
export const KDF_ITERATIONS = 310000;

export function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

export function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function hexMessage(value) {
  return `0x${Array.from(encoder.encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The binding between a key and the account, network and origin it belongs to. */
export function scopeFor(owner, chainId, origin = location.origin) {
  return `${origin}|${String(owner).toLowerCase()}|${chainId}|tera-local-vault-v1`;
}

/**
 * The text the wallet signs. The epoch is part of it, which is what makes
 * rotation possible: a signature for epoch 1 cannot derive the epoch 2 key.
 */
export function unlockMessage(scope, epoch) {
  return epoch > 1
    ? `Unlock Tera encrypted local storage\n${scope}\nkey epoch ${epoch}`
    : `Unlock Tera encrypted local storage\n${scope}`;
}

/** Parameters for a new key. The salt and epoch are not secret. */
export function newKeyInfo({ epoch = 1, passphrase = false, iterations = KDF_ITERATIONS } = {}) {
  return {
    version: CURRENT_VERSION,
    epoch,
    salt: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
    iterations,
    passphrase: Boolean(passphrase),
    createdAt: new Date().toISOString(),
  };
}

export function isKeyInfo(info) {
  return Boolean(
    info &&
    typeof info === "object" &&
    info.version === CURRENT_VERSION &&
    Number.isInteger(info.epoch) &&
    info.epoch >= 1 &&
    typeof info.salt === "string" &&
    Number.isInteger(info.iterations) &&
    info.iterations >= 1000,
  );
}

export async function requestSignature(provider, owner, scope, epoch) {
  return provider.request({
    method: "personal_sign",
    params: [hexMessage(unlockMessage(scope, epoch)), owner],
  });
}

/**
 * Derive the AES-GCM key. Without key info this reproduces the version 1
 * derivation, so a vault written before this change still opens.
 */
export async function deriveVaultKey({ signature, scope, info, passphrase = "" }) {
  if (!isKeyInfo(info)) {
    if (passphrase) throw new Error("This vault predates passphrases. Rotate the key to add one.");
    const material = await crypto.subtle.digest("SHA-256", encoder.encode(`${signature}|${scope}`));
    return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }
  if (info.passphrase && !passphrase)
    throw new Error("This vault needs its passphrase as well as your wallet signature.");
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${signature}|${scope}|${passphrase}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(info.salt),
      iterations: info.iterations,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Sign and derive in one step, for the ordinary unlock path. */
export async function unlockVault(provider, owner, chainId, info = null, passphrase = "") {
  const scope = scopeFor(owner, chainId);
  const epoch = isKeyInfo(info) ? info.epoch : 1;
  const signature = await requestSignature(provider, owner, scope, epoch);
  return deriveVaultKey({ signature, scope, info, passphrase });
}

export async function encryptVault(key, payload, retentionDays) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + retentionDays * 86400000).toISOString(),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptVault(key, vault) {
  if (!vault?.iv || !vault?.ciphertext || Date.parse(vault.expiresAt) <= Date.now()) return null;
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(vault.iv) },
    key,
    base64ToBytes(vault.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext));
}

/**
 * Retire the current key and write the same contents under a new one.
 *
 * The caller supplies the already-derived next key, because deriving it needs a
 * wallet signature over the new epoch's message. Returns the new key info and
 * the re-encrypted vault; the caller replaces both together, so a failure
 * part-way through never leaves a vault that nothing can open.
 */
export async function rotate({ key, payload, retentionDays, info }) {
  if (!isKeyInfo(info)) throw new Error("Rotation needs the parameters of the new key.");
  return { info, vault: await encryptVault(key, payload, retentionDays) };
}

/** The epoch a rotation should move to. */
export function nextEpoch(info) {
  return (isKeyInfo(info) ? info.epoch : 1) + 1;
}
