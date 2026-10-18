// The wallet in the browser extension's popup: what it holds and sending
// from it. No network access of its own; extension/src/background.ts reads
// the chain, and every send goes through the same review window, simulation
// and fee cap as a site's request (core/dapp-send.js).
//
// The rules, each one a test:
//
//   The assets are Tera's registry (/api/assets), checked here: an entry
//   with a malformed address or decimals is dropped, and so is one claiming
//   the symbol or address of an asset the wallet already lists, so the
//   registry can't relabel USDG or ETH.
//
//   ETH and USDG are always listed; any other asset only once it has a
//   balance. Holdings are sorted by dollar value, then by name. An asset the
//   registry says tracks ETH (WETH) is priced as ETH.
//
//   An amount is a plain decimal in the asset's own units, never more
//   decimals than the asset has, never zero, never more than the balance.
//   ETH's Max keeps the network fee back (core/max-amount.js).
//
//   The recipient must be a valid address. Not the zero address, and not the
//   token's own contract: both lose the funds for good. Sending to yourself
//   is allowed, and said.

import { formatUnits } from "./dapp-send.js";

export const NATIVE = "0x0000000000000000000000000000000000000000";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const lower = (value) => String(value ?? "").toLowerCase();

/** The registry, checked, with the wallet's own assets first and unchangeable. */
export function cleanRegistry(entries, pinned = []) {
  const assets = pinned.map((asset) => ({ ...asset, address: lower(asset.address) }));
  const taken = (asset) =>
    assets.some((known) => known.address === lower(asset.address) || known.symbol === asset.symbol);
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.status && entry.status !== "ACTIVE") continue;
    if (!ADDRESS.test(String(entry.address))) continue;
    if (!Number.isInteger(entry.decimals) || entry.decimals < 0 || entry.decimals > 36) continue;
    if (typeof entry.symbol !== "string" || !/^[A-Za-z0-9.$-]{1,12}$/.test(entry.symbol)) continue;
    const asset = {
      symbol: entry.symbol,
      name: typeof entry.name === "string" ? entry.name.slice(0, 60) : entry.symbol,
      address: lower(entry.address),
      decimals: entry.decimals,
      // Priced as ETH when the registry says it tracks ETH (WETH).
      ...(entry.currency === "ETH" ? { priceAs: "ETH" } : {}),
    };
    if (taken(asset)) continue;
    assets.push(asset);
  }
  return assets;
}

/**
 * What the wallet holds, ready to list.
 * balances: { address: base units (string) | null when it couldn't be read }
 * Returns [{ ...asset, balance, amount (decimal string) | null, value (USD) | null }].
 */
export function holdings(assets, balances = {}, prices = {}) {
  const always = new Set([NATIVE, "0x5fc5360d0400a0fd4f2af552add042d716f1d168"]);
  return assets
    .map((asset) => {
      const raw = balances[asset.address];
      const balance = raw === null || raw === undefined ? null : BigInt(raw);
      const amount = balance === null ? null : plainUnits(balance, asset.decimals);
      const price = Number(prices[asset.priceAs ?? asset.symbol]);
      const value =
        amount !== null && Number.isFinite(price) && price >= 0 ? Number(amount) * price : null;
      return { ...asset, balance: balance === null ? null : balance.toString(), amount, value };
    })
    .filter((row) => always.has(row.address) || (row.balance !== null && row.balance !== "0"))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.symbol.localeCompare(b.symbol));
}

/** Base units as a full-precision decimal string: 1500000 at 6 decimals is "1.5". */
export function plainUnits(units, decimals) {
  const amount = BigInt(units);
  const unit = 10n ** BigInt(decimals);
  const frac = (amount % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${amount / unit}${frac ? `.${frac}` : ""}`;
}

/** A typed amount as base units: { units } or { error }. */
export function toUnits(text, decimals) {
  const value = String(text ?? "").trim();
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value);
  if (!value || !match || (!match[1] && !match[2])) return { error: "Enter an amount." };
  const frac = match[2] ?? "";
  if (frac.length > decimals)
    return { error: `This asset has ${decimals} decimal places at most.` };
  const units = BigInt((match[1] || "0") + frac.padEnd(decimals, "0"));
  if (units === 0n) return { error: "Enter an amount above zero." };
  return { units };
}

/** Whether the wallet has enough. Returns an error message, or null. */
export function checkAmount({ units, balance, symbol, decimals }) {
  if (balance === null || balance === undefined)
    return `Couldn't read your ${symbol} balance. Try again in a moment.`;
  if (BigInt(units) > BigInt(balance))
    return `That's more than your ${formatUnits(balance, decimals)} ${symbol}.`;
  return null;
}

/** The recipient, checked: { address, self? } or { error }. */
export function checkRecipient(text, { owner, asset }) {
  const value = String(text ?? "").trim();
  if (!ADDRESS.test(value)) return { error: "Enter a 0x address of 40 characters." };
  const address = lower(value);
  if (address === NATIVE) return { error: "That's the zero address. Anything sent there is lost." };
  if (asset && asset.address !== NATIVE && address === lower(asset.address))
    return {
      error: `That's the ${asset.symbol} contract itself. Tokens sent there are lost.`,
    };
  return { address, self: address === lower(owner) };
}

/** The transaction for a send: ETH directly, a token through transfer(). */
export function buildTransfer({ owner, asset, to, units }) {
  const amount = BigInt(units);
  if (asset.address === NATIVE)
    return { from: owner, to: lower(to), value: `0x${amount.toString(16)}`, data: "0x" };
  return {
    from: owner,
    to: asset.address,
    value: "0x0",
    data:
      "0xa9059cbb" + lower(to).slice(2).padStart(64, "0") + amount.toString(16).padStart(64, "0"),
  };
}
