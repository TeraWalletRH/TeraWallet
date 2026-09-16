const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function hexMessage(value) {
  return `0x${Array.from(encoder.encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function unlockVault(provider, owner, chainId) {
  const scope = `${location.origin}|${owner.toLowerCase()}|${chainId}|tera-local-vault-v1`;
  const signature = await provider.request({
    method: "personal_sign",
    params: [hexMessage(`Unlock Tera encrypted local storage\n${scope}`), owner],
  });
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`${signature}|${scope}`));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptVault(key, payload, retentionDays) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(payload)));
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
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(vault.iv) }, key, base64ToBytes(vault.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}
