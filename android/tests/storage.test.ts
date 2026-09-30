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

// Password-derived encryption is deliberately slow: PASSWORD_ITERATIONS is
// 100,000 rounds of PBKDF2-SHA256, and the legacy path re-derives at 210,000.
// Each derivation costs seconds rather than milliseconds on a modest machine,
// and these tests perform several apiece, so they run well past bun's 5s
// default.
//
// The timeout is raised rather than the iteration count lowered. The iteration
// count is a security parameter — the thing standing between a stolen phone and
// a seed phrase — and shrinking it so a test finishes sooner would weaken the
// product to flatter the harness.
const DERIVES_A_KEY = 60_000;

it(
  "persists only ciphertext and restores the same wallet after locking",
  async () => {
    const address = await vault.createWallet(phrase, password);
    await vault.saveData({ ...vault.emptyData(), token: "secret-test-token" });
    expect([...secure.values()].join("")).not.toContain(phrase);
    expect([...files.values()].join("")).not.toContain("secret-test-token");
    vault.lock();
    expect(() => vault.currentAccount()).toThrow();
    expect(await vault.unlock(password)).toBe(address);
    expect((await vault.loadData()).token).toBe("secret-test-token");
    await expect(vault.createWallet(phrase, password)).rejects.toThrow();
  },
  DERIVES_A_KEY,
);

it(
  "a lock during password derivation prevents a late unlock",
  async () => {
    await vault.createWallet(phrase, password);
    vault.lock();
    const attempt = vault.unlock(password);
    vault.lock();
    await expect(attempt).rejects.toThrow();
    expect(vault.isUnlocked()).toBe(false);
  },
  DERIVES_A_KEY,
);

it(
  "wrong passwords fail and erasure removes wallet, biometrics and history",
  async () => {
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
  },
  DERIVES_A_KEY,
);

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

it(
  "adds wallets from the one phrase, at the standard path, and switches between them",
  async () => {
    const first = await vault.createWallet(phrase, password);
    expect(vault.listAccounts()).toEqual([{ index: 0, address: first, name: "", active: true }]);

    const second = await vault.addAccount();
    expect(second).not.toBe(first);
    // The standard Ethereum path, so any other wallet app recovers this account
    // from the phrase alone. A private path would make it recoverable only here.
    const { mnemonicToAccount } = await import("viem/accounts");
    expect(second).toBe(mnemonicToAccount(phrase, { path: "m/44'/60'/0'/0/1" }).address);
    expect(vault.currentAccount().address).toBe(second);

    expect(await vault.selectAccount(0)).toBe(first);
    expect(vault.currentAccount().address).toBe(first);
    expect(vault.listAccounts().map((entry) => entry.active)).toEqual([true, false]);
  },
  DERIVES_A_KEY,
);

it(
  "keeps the wallet list, the selection and the names across a lock",
  async () => {
    await vault.createWallet(phrase, password);
    const second = await vault.addAccount();
    await vault.renameAccount(1, "Spending");
    vault.lock();
    // Opens on the wallet the owner was last using, not on the first one.
    expect(await vault.unlock(password)).toBe(second);
    expect(vault.selectedIndex()).toBe(1);
    expect(vault.listAccounts().map((entry) => entry.name)).toEqual(["", "Spending"]);
  },
  DERIVES_A_KEY,
);

it(
  "gives each wallet its own encrypted data, and never mixes them",
  async () => {
    await vault.createWallet(phrase, password);
    await vault.saveData({ ...vault.emptyData(), token: "first-wallet-token" });
    await vault.addAccount();
    // A fresh wallet starts empty rather than inheriting the previous one's
    // drafts and history, which would show one wallet's activity under another.
    expect((await vault.loadData()).token).toBe("");
    await vault.saveData({ ...vault.emptyData(), token: "second-wallet-token" });
    await vault.selectAccount(0);
    expect((await vault.loadData()).token).toBe("first-wallet-token");
  },
  DERIVES_A_KEY,
);

it(
  "opens a wallet saved before multiple wallets existed, untouched",
  async () => {
    const address = await vault.createWallet(phrase, password);
    // Strip the fields this feature added, leaving exactly what an older build
    // wrote. Nothing should need migrating.
    const stored = JSON.parse(secure.get("tera.wallet.v1")!);
    delete stored.accounts;
    delete stored.selected;
    delete stored.names;
    secure.set("tera.wallet.v1", JSON.stringify(stored));
    vault.lock();
    expect(await vault.unlock(password)).toBe(address);
    expect(vault.listAccounts()).toEqual([{ index: 0, address, name: "", active: true }]);
  },
  DERIVES_A_KEY,
);

it(
  "a PIN migration keeps the wallets and still unlocks from another account",
  async () => {
    // The envelope is rebuilt from scratch here rather than spread, so the
    // account fields have to be carried across by hand — and `address` has to
    // stay the first account's, because that is what `unlock` checks the
    // decrypted phrase against.
    await vault.createWallet(phrase, password);
    const second = await vault.addAccount();
    await vault.renameAccount(1, "Savings");
    await vault.migrateToPin(password, "654321");
    vault.lock();
    expect(await vault.unlock("654321")).toBe(second);
    expect(vault.listAccounts().map((entry) => entry.name)).toEqual(["", "Savings"]);
  },
  DERIVES_A_KEY,
);

it("refuses to add or switch wallets while locked", async () => {
  vault.lock();
  await expect(vault.addAccount()).rejects.toThrow();
  await expect(vault.selectAccount(0)).rejects.toThrow();
  await expect(vault.renameAccount(0, "x")).rejects.toThrow();
  expect(() => vault.listAccounts()).toThrow();
});

// Hardhat's first development account: a published test key, never funded.
const testKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const testKeyAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

it(
  "imports a private key as a one-account wallet with no phrase",
  async () => {
    // Pasted without the prefix and in capitals, the way some wallets export it.
    const address = await vault.createWallet(testKey.slice(2).toUpperCase(), password);
    expect(address).toBe(testKeyAddress);
    expect([...secure.values()].join("")).not.toContain(testKey.slice(2));
    expect(vault.hasPhrase()).toBe(false);
    expect(() => vault.revealPhrase()).toThrow();
    await expect(vault.addAccount()).rejects.toThrow();
    expect(vault.exportPrivateKey(0)).toEqual({ address, privateKey: testKey });
    await vault.saveData({ ...vault.emptyData(), token: "key-wallet-token" });
    vault.lock();
    expect(await vault.unlock(password)).toBe(address);
    expect((await vault.loadData()).token).toBe("key-wallet-token");
  },
  DERIVES_A_KEY,
);

it("rejects text that is neither a phrase nor a key", async () => {
  await expect(vault.createWallet(`0x${"0".repeat(64)}`, password)).rejects.toThrow();
  await expect(vault.createWallet("0x1234", password)).rejects.toThrow();
  expect(await vault.hasWallet()).toBe(false);
});

it(
  "seals a named record for the whole wallet, readable from any of its accounts",
  async () => {
    await vault.createWallet(phrase, password);
    const book = { watch: ["0xcd3B766CCDd6AE721141F452C550Ca635964ce71"], groups: { a: "Payroll" } };
    await vault.saveSealed("business-book", book);
    expect([...files.values()].join("")).not.toContain("Payroll");
    await vault.addAccount();
    expect(await vault.loadSealed<typeof book>("business-book")).toEqual(book);
    expect(await vault.loadSealed("missing")).toBeNull();
    vault.lock();
    await expect(vault.loadSealed("business-book")).rejects.toThrow();
  },
  DERIVES_A_KEY,
);

// The recovery path below only ever runs after a crash, which is exactly why
// it is tested here: nothing in ordinary use would reveal it as broken, and
// what it protects is a transaction that may already be on chain under a hash
// the wallet would otherwise have forgotten.

it(
  "a send interrupted before its history row is written comes back as a pending row",
  async () => {
    const address = await vault.createWallet(phrase, password);
    const hash = `0x${"ab".repeat(32)}`;
    // No saveData first: the first send is the one most worth recovering, and
    // at that point the wallet has no data file at all.
    await vault.notePending({ hash, owner: address, step: 1, totalSteps: 1, createdAt: Date.now() });
    expect([...files.values()].join("")).not.toContain(hash);

    const recovered = await vault.loadData();
    expect(recovered.history).toHaveLength(1);
    expect(recovered.history[0]).toMatchObject({ hash, status: "broadcasting", recovered: true });
    // No title and no amount: after a crash the wallet does not know them, and
    // inventing either would describe a payment it cannot account for.
    expect(recovered.history[0].title).toBeUndefined();

    // Once the real row lands, the recovered one must not double it.
    await vault.saveData({
      ...vault.emptyData(),
      history: [{ hash, status: "pending", createdAt: Date.now(), title: "Sent 1 ETH" }],
    });
    const settled = await vault.loadData();
    expect(settled.history).toHaveLength(1);
    expect(settled.history[0]).toMatchObject({ hash, status: "pending", title: "Sent 1 ETH" });
  },
  DERIVES_A_KEY,
);

it(
  "a recovered send outlives retention and stays with the account that made it",
  async () => {
    const first = await vault.createWallet(phrase, password);
    const second = await vault.addAccount();
    const mine = `0x${"11".repeat(32)}`;
    const theirs = `0x${"22".repeat(32)}`;
    const old = Date.now() - 30 * 86400000;

    // Old enough that retention would drop a completed row of the same age.
    await vault.notePending({ hash: mine, owner: second, step: 1, totalSteps: 1, createdAt: old });
    await vault.notePending({ hash: theirs, owner: first, step: 1, totalSteps: 1, createdAt: old });
    await vault.saveData({ ...vault.emptyData(), retention: 7 });

    const onSecond = await vault.loadData();
    expect(onSecond.history.map((row: any) => row.hash)).toEqual([mine]);

    expect(await vault.selectAccount(0)).toBe(first);
    const onFirst = await vault.loadData();
    expect(onFirst.history.map((row: any) => row.hash)).toEqual([theirs]);
  },
  DERIVES_A_KEY,
);

it(
  "a pending note more than a day old is dropped by the next send",
  async () => {
    const address = await vault.createWallet(phrase, password);
    const stale = `0x${"33".repeat(32)}`;
    const fresh = `0x${"44".repeat(32)}`;
    const now = Date.now();
    await vault.notePending({
      hash: stale,
      owner: address,
      step: 1,
      totalSteps: 1,
      createdAt: now - 2 * 86400000,
    });
    await vault.notePending({ hash: fresh, owner: address, step: 1, totalSteps: 1, createdAt: now });
    expect((await vault.loadData()).history.map((row: any) => row.hash)).toEqual([fresh]);
  },
  DERIVES_A_KEY,
);
