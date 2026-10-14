// The Max button on Send, and what a dollar amount comes to in tokens. No
// UI of its own; android/App.tsx reads the fee estimate and the balance.
//
// The rules, each one a test:
//
//   A token's Max is the whole balance: its network fee is paid in ETH.
//
//   ETH's Max is the balance minus the network fee, because the fee comes out
//   of the same balance and a send of all of it can't be paid for. The fee
//   kept back is the live estimate doubled (fees move between pressing Max
//   and signing), and never more than the wallet's 0.001 ETH per-step fee
//   limit: a fee above that is refused anyway. With no estimate the limit
//   itself is kept back. A balance smaller than the fee gives 0, never a
//   negative.
//
//   A dollar amount turns into tokens rounded down, and a token amount into
//   dollars rounded down to the cent, so neither ever comes to more than the
//   owner typed or has.

export const FEE_CAP_WEI = 10n ** 15n; // 0.001 ETH, network.ts's per-step limit

const big = (value) => {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
};

/** The ETH kept back for the fee, in wei, from a gas estimate and a max fee per gas. */
export function feeReserve(gas, maxFeePerGas) {
  const g = big(gas);
  const f = big(maxFeePerGas);
  if (g <= 0n || f <= 0n) return FEE_CAP_WEI;
  const doubled = g * f * 2n;
  return doubled < FEE_CAP_WEI ? doubled : FEE_CAP_WEI;
}

/** The most that can be sent, in base units, as a string. */
export function maxSendable({ balance, native, reserve = FEE_CAP_WEI }) {
  const b = big(balance);
  if (!native) return (b > 0n ? b : 0n).toString();
  const left = b - big(reserve);
  return (left > 0n ? left : 0n).toString();
}

const PRICE_DECIMALS = 12;
const scaled = (price) => {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 10 ** PRICE_DECIMALS));
};

/** Dollars (a decimal string) as token base units, rounded down. Null without a price. */
export function tokensForDollars(dollars, price, decimals) {
  const p = scaled(price);
  const m = /^(\d*)(?:\.(\d*))?$/.exec(String(dollars ?? "").trim());
  if (!p || !m || (!m[1] && !m[2])) return null;
  const cents = BigInt((m[1] || "0") + (m[2] || "").padEnd(PRICE_DECIMALS, "0").slice(0, PRICE_DECIMALS));
  return ((cents * 10n ** BigInt(decimals)) / p).toString();
}

/** Token base units in dollars, rounded down to the cent, as "12.34". Null without a price. */
export function dollarsForTokens(units, price, decimals) {
  const p = scaled(price);
  if (!p) return null;
  const centsTotal = (big(units) * p) / 10n ** BigInt(decimals) / 10n ** BigInt(PRICE_DECIMALS - 2);
  const whole = centsTotal / 100n;
  const cents = (centsTotal % 100n).toString().padStart(2, "0");
  return `${whole}.${cents}`;
}
