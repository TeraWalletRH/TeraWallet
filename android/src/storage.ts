import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as LocalAuth from "expo-local-authentication";
import * as FS from "expo-file-system/legacy";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  dataKey,
  LEGACY_PASSWORD_ITERATIONS,
  normalizePhrase,
  PASSWORD_ITERATIONS,
  open,
  passwordKey,
  phraseFromEntropy,
  seal,
  walletFromPhrase,
  type Box,
} from "./crypto";
const WALLET = "tera.wallet.v1";
const BIOMETRIC = "tera.wallet.biometric.v1";
const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
type Envelope = { v: 1; address: string; salt: string; box: Box; kdf?: number; pin?: true };
export type LocalData = {
  drafts: any[];
  history: any[];
  token: string;
  retention: number;
  language: "en" | "zh";
};
export const emptyData = (): LocalData => ({
  drafts: [],
  history: [],
  token: "",
  retention: 30,
  language: "en",
});
let phrase: string | null = null;
let epoch = 0;
let serial: Promise<void> = Promise.resolve();
export let authenticating = false;
export const sessionVersion = () => epoch;
export const isUnlocked = () => phrase !== null;
export const currentAccount = () => {
  if (!phrase) throw new Error("Wallet locked. / 钱包已锁定。");
  return walletFromPhrase(phrase);
};
export function lock() {
  phrase = null;
  epoch++;
}
const random = (n: number) => Crypto.getRandomValues(new Uint8Array(n));
export const newPhrase = () => phraseFromEntropy(random(16));
export async function hasWallet() {
  return !!(await SecureStore.getItemAsync(WALLET, opts));
}
export async function usesPin() {
  try {
    return (await envelope()).pin === true;
  } catch {
    return false;
  }
}
const assertPin = (pin: string) => {
  if (!/^\d{6}$/.test(pin)) throw new Error("Use a six-digit PIN. / 请输入六码 PIN。");
};
export async function createWallet(mnemonic: string, password: string) {
  if (await hasWallet()) throw new Error("A wallet already exists. / 钱包已存在。");
  assertPin(password);
  const version = epoch;
  const normalized = normalizePhrase(mnemonic);
  const account = walletFromPhrase(normalized);
  const salt = random(16);
  const key = await passwordKey(password, salt);
  try {
    if (version !== epoch) throw new Error("Setup interrupted. / 设置已中断。");
    const envelope: Envelope = {
      v: 1,
      address: account.address,
      salt: bytesToHex(salt),
      box: seal(key, normalized, random(12)),
      kdf: PASSWORD_ITERATIONS,
      pin: true,
    };
    await SecureStore.setItemAsync(WALLET, JSON.stringify(envelope), opts);
    if (version !== epoch) throw new Error("Unlock your saved wallet. / 请解锁已保存的钱包。");
    phrase = normalized;
    return account.address;
  } finally {
    key.fill(0);
  }
}
async function envelope(): Promise<Envelope> {
  const raw = await SecureStore.getItemAsync(WALLET, opts);
  if (!raw) throw new Error("Wallet unavailable. / 钱包不可用。");
  return JSON.parse(raw);
}
async function upgradeLegacyEnvelope(
  password: string,
  saved: Envelope,
  recovered: string,
  version: number,
) {
  // Let the home screen paint before the one-time migration competes for CPU.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const key = await passwordKey(password, hexToBytes(saved.salt), PASSWORD_ITERATIONS);
  try {
    if (version !== epoch || phrase !== recovered) return;
    await SecureStore.setItemAsync(
      WALLET,
      JSON.stringify({ ...saved, kdf: PASSWORD_ITERATIONS, box: seal(key, recovered, random(12)) }),
      opts,
    );
  } finally {
    key.fill(0);
  }
}
export async function unlock(password: string | null) {
  const version = epoch;
  const saved = await envelope();
  let key: Uint8Array | undefined;
  try {
    if (password === null) {
      authenticating = true;
      const value = await SecureStore.getItemAsync(BIOMETRIC, {
        ...opts,
        requireAuthentication: true,
        authenticationPrompt: "Unlock Tera Wallet / 解锁 Tera 钱包",
      });
      if (!value) throw new Error("Use your wallet password. / 请使用钱包密码。");
      key = hexToBytes(value);
    } else {
      if (saved.pin) assertPin(password);
      key = await passwordKey(password, hexToBytes(saved.salt), saved.kdf ?? LEGACY_PASSWORD_ITERATIONS);
    }
    const recovered = open(key, saved.box);
    const account = walletFromPhrase(recovered);
    if (account.address !== saved.address || version !== epoch)
      throw new Error("Wallet changed. / 钱包已更改。");
    phrase = recovered;
    if (password !== null && !saved.kdf)
      void upgradeLegacyEnvelope(password, saved, recovered, version).catch(() => {});
    return account.address;
  } catch {
    throw new Error(
      "Could not unlock. Check your password or use phrase recovery. / 无法解锁，请检查密码或使用助记词恢复。",
    );
  } finally {
    key?.fill(0);
    authenticating = false;
  }
}
export async function migrateToPin(currentPassword: string, pin: string) {
  assertPin(pin);
  await unlock(currentPassword);
  const recovered = phrase!;
  const salt = random(16);
  const key = await passwordKey(pin, salt, PASSWORD_ITERATIONS);
  try {
    await SecureStore.setItemAsync(
      WALLET,
      JSON.stringify({
        v: 1,
        address: currentAccount().address,
        salt: bytesToHex(salt),
        box: seal(key, recovered, random(12)),
        kdf: PASSWORD_ITERATIONS,
        pin: true,
      } satisfies Envelope),
      opts,
    );
  } finally {
    key.fill(0);
  }
}
export async function enableBiometrics(password: string) {
  if (!(await LocalAuth.hasHardwareAsync()) || !(await LocalAuth.isEnrolledAsync()))
    throw new Error("Set up device biometrics first. / 请先设置设备生物识别。");
  await unlock(password);
  const saved = await envelope();
  const key = await passwordKey(password, hexToBytes(saved.salt));
  try {
    authenticating = true;
    await SecureStore.setItemAsync(BIOMETRIC, bytesToHex(key), {
      ...opts,
      requireAuthentication: true,
      authenticationPrompt: "Enable Tera biometric unlock / 启用生物识别解锁",
    });
  } finally {
    key.fill(0);
    authenticating = false;
  }
}
export const revealPhrase = () => {
  currentAccount();
  return phrase!;
};
const dataPath = (address: string) => `${FS.documentDirectory}tera-${address.toLowerCase()}.json`;
export async function loadData(): Promise<LocalData> {
  const address = currentAccount().address;
  const key = dataKey(phrase!);
  try {
    const path = dataPath(address);
    if (!(await FS.getInfoAsync(path)).exists) return emptyData();
    const saved = JSON.parse(open(key, JSON.parse(await FS.readAsStringAsync(path))));
    const data: LocalData = { ...emptyData(), ...saved };
    const cutoff = Date.now() - data.retention * 86400000;
    data.drafts = data.drafts.filter((d) => d.createdAt > cutoff);
    data.history = data.history.filter(
      (d) =>
        d.createdAt > cutoff ||
        !["confirmed", "success", "refund", "reverted", "failure"].includes(d.status),
    );
    return data;
  } finally {
    key.fill(0);
  }
}
export function saveData(data: LocalData) {
  const address = currentAccount().address;
  const version = epoch;
  const key = dataKey(phrase!);
  const snapshot = JSON.stringify(seal(key, JSON.stringify(data), random(12)));
  key.fill(0);
  const work = serial
    .catch(() => {})
    .then(async () => {
      if (version !== epoch) throw new Error("Wallet locked before saving. / 保存前钱包已锁定。");
      await FS.writeAsStringAsync(dataPath(address), snapshot);
    });
  serial = work;
  return work;
}
export async function eraseWallet() {
  const saved = await envelope();
  lock();
  await serial.catch(() => {});
  await FS.deleteAsync(dataPath(saved.address), { idempotent: true });
  await SecureStore.deleteItemAsync(BIOMETRIC, opts);
  await SecureStore.deleteItemAsync(WALLET, opts);
}
