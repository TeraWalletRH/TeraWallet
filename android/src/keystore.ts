// Where the sealed wallet and its data file live on a phone.
//
// storage.ts decides what is written and when; this file is only the place it
// goes. The browser build swaps in keystore.web.ts, so the rules in storage.ts
// are one copy on both surfaces rather than two that could drift.
import * as SecureStore from "expo-secure-store";
import * as LocalAuth from "expo-local-authentication";
import * as FS from "expo-file-system/legacy";

const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Whether this platform can gate a stored key behind Face ID or a fingerprint. */
export const biometricsSupported = true;

export async function biometricsReady() {
  return (await LocalAuth.hasHardwareAsync()) && (await LocalAuth.isEnrolledAsync());
}

/** `prompt` makes the read or write wait for the owner's biometrics. */
export function secureGet(key: string, prompt?: string) {
  return SecureStore.getItemAsync(
    key,
    prompt ? { ...opts, requireAuthentication: true, authenticationPrompt: prompt } : opts,
  );
}

export function secureSet(key: string, value: string, prompt?: string) {
  return SecureStore.setItemAsync(
    key,
    value,
    prompt ? { ...opts, requireAuthentication: true, authenticationPrompt: prompt } : opts,
  );
}

export function secureDelete(key: string) {
  return SecureStore.deleteItemAsync(key, opts);
}

const path = (name: string) => `${FS.documentDirectory}${name}`;

export async function readFile(name: string): Promise<string | null> {
  if (!(await FS.getInfoAsync(path(name))).exists) return null;
  return FS.readAsStringAsync(path(name));
}

export function writeFile(name: string, text: string) {
  return FS.writeAsStringAsync(path(name), text);
}

export function deleteFile(name: string) {
  return FS.deleteAsync(path(name), { idempotent: true });
}
