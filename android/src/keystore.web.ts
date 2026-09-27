// Where the sealed wallet and its data file live in a browser.
//
// This site's own storage, on this device. Nothing here is sent anywhere, and
// nothing here is readable without the PIN: the wallet is sealed before it
// reaches this file, exactly as on a phone. What a browser lacks is a keychain
// guarding that sealed copy, which is why kdf.web.ts spends more rounds.
//
// No biometrics: a browser cannot hold a key behind Face ID the way the phone's
// keychain does, so the web build offers the PIN only.

const PREFIX = "tera.web.";

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
