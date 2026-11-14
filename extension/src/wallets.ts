// The wallets in this browser: any mix of sealed (a phrase or key under the
// password), watched and Ledger wallets, each with a name, and which one the
// popup shows. Stored as { wallets, active } in the extension's own storage;
// 0.11.0 and before kept a single `vault`, which migrate() turns into the
// first wallet.
//
// Sites connect to one wallet each and keep it: switching the popup to
// another wallet changes nothing a site sees, and a site's requests are
// signed by the wallet it connected to.
//
// Every sealed wallet uses the same password, so one password unlocks Tera:
// a new one is sealed only after the password opens an existing one.

import { isLedger, isWatch, type SealedVault, type Vault } from "./vault";

export type Entry = { name: string; vault: Vault };
export type Kind = "key" | "watch" | "ledger";

export const MAX_NAME = 24;

export const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export const kindOf = (vault: Vault): Kind =>
  isWatch(vault) ? "watch" : isLedger(vault) ? "ledger" : "key";

/** The wallets as stored now, from either shape. */
export function migrate(stored: { vault?: unknown; wallets?: unknown; active?: unknown }) {
  const wallets = Array.isArray(stored.wallets)
    ? (stored.wallets as Entry[]).filter((entry) => entry?.vault?.address)
    : stored.vault && typeof stored.vault === "object" && "address" in stored.vault
      ? [{ name: "Wallet 1", vault: stored.vault as Vault }]
      : [];
  const active = typeof stored.active === "string" ? stored.active : null;
  return { wallets, active: activeEntry(wallets, active)?.vault.address ?? null };
}

export const entryFor = (wallets: Entry[], address: string | null | undefined) =>
  wallets.find((entry) => same(entry.vault.address, address)) ?? null;

/** The wallet the popup shows: the chosen one, or the first if that's gone. */
export const activeEntry = (wallets: Entry[], active: string | null | undefined) =>
  entryFor(wallets, active) ?? wallets[0] ?? null;

/** A sealed wallet the password can be checked against, if there is one. */
export const firstSealed = (wallets: Entry[]) =>
  (wallets.find((entry) => kindOf(entry.vault) === "key")?.vault as SealedVault | undefined) ??
  null;

/** "Wallet N" for the first N not taken. */
export function nextName(wallets: Entry[]) {
  const taken = new Set(wallets.map((entry) => entry.name.toLowerCase()));
  let n = wallets.length + 1;
  while (taken.has(`wallet ${n}`)) n++;
  return `Wallet ${n}`;
}

/** Add `vault` and make it the one shown. Throws if it's already here. */
export function addWallet(wallets: Entry[], vault: Vault) {
  const there = entryFor(wallets, vault.address);
  if (there) throw new Error(`That wallet is already in Tera, as ${there.name}.`);
  return { wallets: [...wallets, { name: nextName(wallets), vault }], active: vault.address };
}

/** Take a wallet out; the one shown moves to the first left. */
export function removeWallet(wallets: Entry[], address: string) {
  const left = wallets.filter((entry) => !same(entry.vault.address, address));
  return { wallets: left, active: left[0]?.vault.address ?? null };
}

/** A tidy name: trimmed, one line, not too long, and not another wallet's. */
export function checkName(wallets: Entry[], address: string, name: unknown) {
  const text = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { error: "Give the wallet a name." };
  if (text.length > MAX_NAME) return { error: `Keep it to ${MAX_NAME} characters.` };
  if (
    wallets.some(
      (entry) =>
        !same(entry.vault.address, address) && entry.name.toLowerCase() === text.toLowerCase(),
    )
  )
    return { error: "Another wallet already has that name." };
  return { name: text };
}

/** What the popup and the approval window are told about each wallet. */
export const listWallets = (wallets: Entry[]) =>
  wallets.map((entry) => ({
    address: entry.vault.address,
    name: entry.name,
    kind: kindOf(entry.vault),
  }));
