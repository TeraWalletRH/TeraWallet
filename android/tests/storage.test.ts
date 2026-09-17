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
const phrase = "test test test test test test test test test test test junk";
const password = "123456";
beforeEach(() => {
  vault.lock();
  secure.clear();
  files.clear();
});

it("persists only ciphertext and restores the same wallet after locking", async () => {
  const address = await vault.createWallet(phrase, password);
  await vault.saveData({ ...vault.emptyData(), token: "secret-test-token" });
  expect([...secure.values()].join("")).not.toContain(phrase);
  expect([...files.values()].join("")).not.toContain("secret-test-token");
  vault.lock();
  expect(() => vault.currentAccount()).toThrow();
  expect(await vault.unlock(password)).toBe(address);
  expect((await vault.loadData()).token).toBe("secret-test-token");
  await expect(vault.createWallet(phrase, password)).rejects.toThrow();
});

it("a lock during password derivation prevents a late unlock", async () => {
  await vault.createWallet(phrase, password);
  vault.lock();
  const attempt = vault.unlock(password);
  vault.lock();
  await expect(attempt).rejects.toThrow();
  expect(vault.isUnlocked()).toBe(false);
});

it("wrong passwords fail and erasure removes wallet, biometrics and history", async () => {
  await vault.createWallet(phrase, password);
  await vault.enableBiometrics(password);
  await vault.saveData(vault.emptyData());
  vault.lock();
  await expect(vault.unlock("000000")).rejects.toThrow();
  expect(vault.isUnlocked()).toBe(false);
  await vault.eraseWallet();
  expect(await vault.hasWallet()).toBe(false);
  expect(secure.size).toBe(0);
  expect(files.size).toBe(0);
});

it("retention prunes old drafts and completed history, preserving pending hashes", async () => {
  await vault.createWallet(phrase, password);
  await vault.saveData({
    ...vault.emptyData(),
    retention: 7,
    drafts: [{ createdAt: 1 }],
    history: [
      { createdAt: 1, status: "confirmed" },
      { createdAt: 1, status: "pending", hash: "pending-test" },
    ],
  });
  const loaded = await vault.loadData();
  expect(loaded.drafts).toHaveLength(0);
  expect(loaded.history).toEqual([{ createdAt: 1, status: "pending", hash: "pending-test" }]);
});
