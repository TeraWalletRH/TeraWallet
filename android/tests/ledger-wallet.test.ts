import { beforeEach, expect, it, mock } from "bun:test";
import { webcrypto } from "node:crypto";

const secure = new Map<string, string>();
const files = new Map<string, string>();
mock.module("expo-crypto", () => ({
  getRandomValues: (bytes: Uint8Array) => webcrypto.getRandomValues(bytes),
}));
mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => secure.get(key) || null,
  setItemAsync: async (key: string, value: string) => {
    secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secure.delete(key);
  },
}));
mock.module("expo-local-authentication", () => ({
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
}));
mock.module("expo-file-system/legacy", () => ({
  documentDirectory: "mock://",
  getInfoAsync: async (path: string) => ({ exists: files.has(path) }),
  readAsStringAsync: async (path: string) => files.get(path),
  writeAsStringAsync: async (path: string, value: string) => {
    files.set(path, value);
  },
  deleteAsync: async (path: string) => {
    files.delete(path);
  },
}));
const vault = await import("../src/storage");
const path = "44'/60'/0'/0/0";
const address = "0x0000000000000000000000000000000000000001";
const phrase = "test test test test test test test test test test test junk";
const password = "123456";
beforeEach(() => {
  vault.lock();
  secure.clear();
  files.clear();
});

// Same reasoning as storage.test.ts's DERIVES_A_KEY: a real PBKDF2 derivation,
// even against a fixed, non-secret key, costs seconds on a modest machine.
const DERIVES_A_KEY = 60_000;

it(
  "saves a Ledger wallet, reports its kind without decrypting, and restores it after locking",
  async () => {
    expect(await vault.isLedgerWallet()).toBe(false);
    const created = await vault.createLedgerWallet(path, address);
    expect(created).toBe(address);
    expect(await vault.isLedgerWallet()).toBe(true);
    expect(vault.isLedger()).toBe(true);
    expect(vault.hasPhrase()).toBe(false);
    expect(vault.currentAccount().address.toLowerCase()).toBe(address.toLowerCase());

    vault.lock();
    expect(() => vault.currentAccount()).toThrow();
    expect(await vault.unlockLedger()).toBe(address);
    expect(vault.isLedger()).toBe(true);
    expect(vault.currentAccount().address.toLowerCase()).toBe(address.toLowerCase());
  },
  DERIVES_A_KEY,
);

it(
  "never has a private key to export",
  async () => {
    await vault.createLedgerWallet(path, address);
    expect(() => vault.exportPrivateKey(0)).toThrow();
  },
  DERIVES_A_KEY,
);

it(
  "refuses a second wallet once one exists, Ledger or not",
  async () => {
    await vault.createLedgerWallet(path, address);
    await expect(vault.createLedgerWallet(path, address)).rejects.toThrow();
    await expect(vault.createWallet(phrase, password)).rejects.toThrow();
  },
  DERIVES_A_KEY,
);

it(
  "a seed wallet is never mistaken for a Ledger one",
  async () => {
    await vault.createWallet(phrase, password);
    expect(await vault.isLedgerWallet()).toBe(false);
    expect(vault.isLedger()).toBe(false);
    await expect(vault.unlockLedger()).rejects.toThrow();
  },
  DERIVES_A_KEY,
);
