// src/wallets.ts: the list of wallets, the old single-wallet shape, and names.
import { expect, it } from "bun:test";
import {
  activeEntry,
  addWallet,
  checkName,
  firstSealed,
  migrate,
  nextName,
  removeWallet,
  type Entry,
} from "../src/wallets";
import type { Vault } from "../src/vault";

const A = "0xAAaa000000000000000000000000000000000001";
const B = "0xbbBB000000000000000000000000000000000002";
const C = "0xcccc000000000000000000000000000000000003";
const sealed = (address: string) =>
  ({ v: 1, kdf: 1, salt: "00", box: {} as never, address }) as Vault;
const watched = (address: string): Vault => ({ v: 1, watch: true, address });
const onLedger = (address: string): Vault => ({
  v: 1,
  ledger: true,
  address,
  path: "44'/60'/0'/0/0",
});

it("turns 0.11's single vault into the first wallet", () => {
  expect(migrate({ vault: sealed(A) })).toEqual({
    wallets: [{ name: "Wallet 1", vault: sealed(A) }],
    active: A,
  });
  expect(migrate({})).toEqual({ wallets: [], active: null });
  // The new shape wins over a leftover vault, and a missing active falls back.
  const wallets: Entry[] = [{ name: "Main", vault: watched(B) }];
  expect(migrate({ vault: sealed(A), wallets, active: C })).toEqual({ wallets, active: B });
});

it("adds wallets once each, and shows the new one", () => {
  let list: Entry[] = [];
  ({ wallets: list } = addWallet(list, sealed(A)));
  const added = addWallet(list, watched(B));
  expect(added.active).toBe(B);
  expect(added.wallets.map((w) => w.name)).toEqual(["Wallet 1", "Wallet 2"]);
  expect(() => addWallet(added.wallets, onLedger(A.toLowerCase()))).toThrow(
    "already in Tera, as Wallet 1",
  );
});

it("names skip ones already taken", () => {
  const list: Entry[] = [
    { name: "Wallet 2", vault: sealed(A) },
    { name: "Savings", vault: sealed(B) },
  ];
  expect(nextName(list)).toBe("Wallet 3");
  expect(nextName([{ name: "Wallet 2", vault: sealed(A) }])).toBe("Wallet 3");
});

it("removing moves the shown wallet to the first left", () => {
  const list: Entry[] = [
    { name: "One", vault: sealed(A) },
    { name: "Two", vault: watched(B) },
  ];
  expect(removeWallet(list, A.toLowerCase())).toEqual({ wallets: [list[1]], active: B });
  expect(removeWallet([list[0]], A)).toEqual({ wallets: [], active: null });
  expect(activeEntry(list, C)?.name).toBe("One");
});

it("finds a sealed wallet to check the password against", () => {
  expect(firstSealed([{ name: "W", vault: watched(A) }])).toBeNull();
  expect(
    firstSealed([
      { name: "W", vault: watched(A) },
      { name: "L", vault: onLedger(B) },
      { name: "K", vault: sealed(C) },
    ])?.address,
  ).toBe(C);
});

it("checks names", () => {
  const list: Entry[] = [
    { name: "Main", vault: sealed(A) },
    { name: "Savings", vault: sealed(B) },
  ];
  expect(checkName(list, A, "  Day   to day ")).toEqual({ name: "Day to day" });
  expect(checkName(list, A, "savings").error).toBe("Another wallet already has that name.");
  expect(checkName(list, B, "Savings")).toEqual({ name: "Savings" });
  expect(checkName(list, A, " ").error).toBe("Give the wallet a name.");
  expect(checkName(list, A, "x".repeat(25)).error).toBe("Keep it to 24 characters.");
});
