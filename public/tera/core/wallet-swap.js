// Swapping and staking from the browser extension's popup. No network access
// of its own; extension/src/background.ts asks Tera's API for a quote or a
// staking request, checks it with these rules and android/src/proposals.ts,
// and the owner confirms in the review window.
//
// The rules, each one a test:
//
//   Tera trades one asset against USDG, as in the app: Buy pays USDG, Sell
//   receives it. TERA trades against ETH instead. ETH and USDG themselves
//   aren't offered as the asset.
//
//   A swap's review says what's paid, what's expected back, and the least
//   that can come back after the owner's slippage limit (the swap reverts
//   below it). Price impact is judged by core/price-impact.js: past 15% the
//   swap is refused, past 5% the owner must tick that they accept the loss.
//
//   Each step is named: an approval says who may take exactly how much, and
//   for how long when it's Permit2. Tera never approves more than the swap.
//
//   Claiming, unstaking and unlocking are signed requests. The text Tera's
//   service asks the wallet to sign must be exactly the text Tera expects
//   for that request, rebuilt here; anything else is refused unsigned.

import { formatUnits } from "./dapp-send.js";
import { assess, message as impactMessage, rowText } from "./price-impact.js";
import { slippageLabel, swapMinimum } from "./slippage.js";

export const NATIVE = "0x0000000000000000000000000000000000000000";
export const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const TERA = "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8";
export const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const lower = (value) => String(value ?? "").toLowerCase();

/** The assets Tera can swap: everything but ETH and USDG. */
export const tradable = (assets = []) =>
  assets.filter((a) => lower(a.address) !== NATIVE && lower(a.address) !== USDG);

/**
 * What a swap pays and receives. Buy pays USDG (ETH for TERA) and receives
 * the asset; Sell is the reverse. Null when a side isn't listed.
 */
export function swapPair(asset, side, assets = []) {
  const other = assets.find(
    (a) => lower(a.address) === (lower(asset?.address) === TERA ? NATIVE : USDG),
  );
  if (!asset || !other || (side !== "BUY" && side !== "SELL")) return null;
  return side === "BUY" ? { pay: other, receive: asset } : { pay: asset, receive: other };
}

const amount = (units, asset) => `${formatUnits(units, asset.decimals)} ${asset.symbol}`;

/**
 * The review of a verified swap.
 * Returns { title, rows, impact, warnings, blocked?, consent? }.
 *
 * @param {{ units: bigint | string, quote: { amountOutWei: string, priceImpactPct?: number, route?: string },
 *   pay: { symbol: string, decimals: number }, receive: { symbol: string, decimals: number },
 *   slippageBps: number, payUsd?: number | null }} input
 */
export function swapReview({ units, quote, pay, receive, slippageBps, payUsd = null }) {
  const minimum = swapMinimum(quote, slippageBps);
  const impact = assess(quote.priceImpactPct, payUsd);
  const rows = [
    ["You pay", amount(units, pay)],
    ["You receive", `≈ ${amount(quote.amountOutWei, receive)}`],
    ["At least", amount(minimum, receive)],
    ["Slippage limit", slippageLabel(slippageBps)],
    ["Price impact", rowText(impact)],
  ];
  if (typeof quote.route === "string" && quote.route)
    rows.push(["Route", quote.route.slice(0, 60)]);
  const warnings = [];
  const said = impactMessage(impact);
  if (said && impact.level !== "blocked") warnings.push(said);
  return {
    title: `Swap ${amount(units, pay)} for ${receive.symbol}`,
    rows,
    impact,
    warnings,
    ...(impact.level === "blocked" ? { blocked: said } : {}),
    ...(impact.level === "confirm" ? { consent: true } : {}),
  };
}

const word = (data, index) => data.slice(10 + index * 64, 10 + (index + 1) * 64);

/**
 * What one step of a verified swap does, in words.
 *
 * @param {{ data: string }} step
 * @param {{ pay?: { symbol: string, decimals: number }, spenders?: Record<string, string> }} [context]
 */
export function stepLabel(step, { pay = { symbol: "", decimals: 0 }, spenders = {} } = {}) {
  const data = lower(step.data);
  const named = (address) =>
    spenders[lower(address)] || `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (data.startsWith("0x095ea7b3")) {
    const spender = `0x${word(data, 0).slice(24)}`;
    const units = BigInt(`0x${word(data, 1)}`);
    const who = lower(spender) === PERMIT2 ? "Permit2" : named(spender);
    return `Approve ${who} to take exactly ${amount(units, pay)}`;
  }
  if (data.startsWith("0x87517c45")) {
    // Permit2 approve(token, spender, uint160 amount, uint48 expiration)
    const units = BigInt(`0x${word(data, 2)}`);
    const expires = Number(BigInt(`0x${word(data, 3)}`));
    const minutes = Math.max(1, Math.round((expires * 1000 - Date.now()) / 60_000));
    return `Let the swap use exactly ${amount(units, pay)} through Permit2, for ${minutes} min`;
  }
  return "Swap";
}

/** The exact text Tera's service has the wallet sign to claim or unstake (backend/src/staking-outbox.ts). */
export function payoutMessage(kind, wallet, epochId, amountUnits, key) {
  return `Tera staking ${kind}\nWallet: ${lower(wallet)}\nEpoch: ${epochId}\nAmount: ${amountUnits}\nRequest: ${key}`;
}

/** The exact text for unlocking a matured fixed lock. */
export function unlockMessage(wallet, lockId, amountUnits, key) {
  return `Tera fixed staking unlock\nWallet: ${lower(wallet)}\nLock: ${lockId}\nAmount: ${amountUnits}\nRequest: ${key}`;
}

/**
 * A staking request ready to sign, or { error } when the service's text
 * isn't the text expected for it.
 *
 * @param {"claim" | "unstake" | "unlock"} kind
 * @param {{ wallet: string, epochId?: string, lockId?: string, amount: string, key: string }} request
 * @param {unknown} given
 */
export function stakingSignature(kind, { wallet, epochId, lockId, amount: units, key }, given) {
  const expected =
    kind === "unlock"
      ? unlockMessage(wallet, lockId, units, key)
      : payoutMessage(kind, wallet, epochId, units, key);
  if (given !== expected)
    return {
      error:
        "Tera's service asked this wallet to sign something other than this request, so nothing was signed.",
    };
  return { message: expected };
}
