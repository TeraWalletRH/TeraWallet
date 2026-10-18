// Transactions from websites, for the Tera browser extension. No network
// access of its own; extension/src/background.ts reads the chain, shows the
// result in the approval window and signs only after the owner approves with
// their password.
//
// The rules, each one a test:
//
//   Only a connected site can ask, only from the address it was given, and
//   only on Robinhood Chain. Creating contracts is not offered.
//
//   Tera chooses the gas and the fees itself; whatever the site suggests is
//   ignored. The most the network fee can cost is capped at 0.001 ETH, as in
//   the app, and a transaction whose amount plus that fee is more than the
//   wallet holds is refused before it is shown.
//
//   The request is described in words. Plain ETH sends and token transfers
//   are low risk. A token approval is red unless it is a limited amount for
//   a contract Tera knows; an unlimited one says so. Approving a whole NFT
//   collection is red. Removing a permission is low risk. Any other contract
//   call is unknown, never safe, and says how much ETH it also sends.
//
//   A recipient that starts and ends like an address this wallet has paid
//   before, but isn't it, is called out as a lookalike.

import { CHAIN_ID, ERRORS, rpcError } from "./dapp-connect.js";
import { FEE_CAP_WEI } from "./max-amount.js";
import { impersonates } from "./poisoning.js";

export { FEE_CAP_WEI };
export const UNLIMITED_FROM = 2n ** 128n;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUANTITY = /^0x[0-9a-fA-F]+$/;
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
const lower = (value) => String(value ?? "").toLowerCase();
const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

const SELECTORS = {
  transfer: "0xa9059cbb",
  approve: "0x095ea7b3",
  transferFrom: "0x23b872dd",
  setApprovalForAll: "0xa22cb465",
  increaseAllowance: "0x39509351",
};

/** wei as ETH, up to 6 decimals: "0.0125", "1", "0". */
export function formatEth(wei) {
  return formatUnits(wei, 18);
}

/** Base units as a decimal string, up to 6 decimals. */
export function formatUnits(raw, decimals) {
  const amount = BigInt(raw);
  const unit = 10n ** BigInt(decimals);
  const whole = amount / unit;
  const frac = (amount % unit).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  const shown = `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
  return shown === "0" && amount > 0n ? "<0.000001" : shown;
}

/**
 * An eth_sendTransaction request, checked and reduced to what Tera signs:
 * { tx: { from, to, value (hex), data } }, or { error }.
 *
 * @param {unknown} params
 * @param {{ accounts?: string[] }} [context]
 */
export function readTransaction(params, { accounts = [] } = {}) {
  if (!accounts.length)
    return {
      error: rpcError(ERRORS.unauthorized, "Connect to Tera before sending a transaction."),
    };
  const request = Array.isArray(params) ? params[0] : undefined;
  if (!request || typeof request !== "object")
    return { error: rpcError(ERRORS.invalidParams, "Expected [{ from, to, value, data }].") };
  const from = request.from ?? accounts[0];
  if (!ADDRESS.test(String(from)) || !accounts.some((a) => lower(a) === lower(from)))
    return { error: rpcError(ERRORS.unauthorized, "This site isn't connected to that address.") };
  if (request.to === undefined || request.to === null || request.to === "")
    return { error: rpcError(ERRORS.unsupported, "Tera doesn't create contracts for sites.") };
  if (!ADDRESS.test(String(request.to)))
    return { error: rpcError(ERRORS.invalidParams, "The recipient isn't a valid address.") };
  const value = request.value ?? "0x0";
  if (!QUANTITY.test(String(value)))
    return { error: rpcError(ERRORS.invalidParams, "The amount must be a hex number.") };
  const data = request.data ?? request.input ?? "0x";
  if (!DATA.test(String(data)))
    return { error: rpcError(ERRORS.invalidParams, "The data must be hex.") };
  if (request.chainId !== undefined && request.chainId !== null) {
    let id;
    try {
      id = BigInt(request.chainId);
    } catch {
      id = null;
    }
    if (id !== BigInt(CHAIN_ID))
      return {
        error: rpcError(
          ERRORS.invalidParams,
          `This transaction is for chain ${request.chainId}. Tera only sends on Robinhood Chain (${CHAIN_ID}).`,
        ),
      };
  }
  return {
    tx: {
      from: accounts.find((a) => lower(a) === lower(from)),
      to: request.to,
      value: `0x${BigInt(value).toString(16)}`,
      data: lower(data),
    },
  };
}

const word = (data, index) => data.slice(10 + index * 64, 10 + (index + 1) * 64);
const wordAddress = (data, index) => `0x${word(data, index).slice(24)}`;
const wordNumber = (data, index) => BigInt(`0x${word(data, index) || "0"}`);

/**
 * What a transaction does, in words.
 * context: { owner, tokens: {address: {symbol, decimals}}, spenders: {address: name}, paid: [address] }
 * Returns { kind, danger: "low" | "unknown" | "high", title, rows: [[label, value]], warnings }.
 */
export function describe(tx, context = {}) {
  const { tokens = {}, spenders = {}, paid = [] } = context;
  const data = lower(tx.data);
  const value = BigInt(tx.value);
  const selector = data.slice(0, 10);
  const token = tokens[lower(tx.to)];
  const symbol = token?.symbol || short(tx.to);
  const amountOf = (raw) =>
    token
      ? `${formatUnits(raw, token.decimals)} ${symbol}`
      : `${raw.toString()} base units of ${symbol}`;
  const who = (address) => spenders[lower(address)] || short(address);
  const warnings = [];
  const rows = [];
  const lookalike = (address) => {
    const match = impersonates(
      address,
      paid.map((a) => ({ address: a })),
    );
    if (match)
      warnings.push(
        // In full: shortened, a lookalike reads exactly like the real one.
        `${address} starts and ends like ${match.address}, an address you've paid before, but it's a different address. Lookalike addresses are a common scam.`,
      );
  };
  const done = (kind, danger, title) => {
    if (value > 0n && kind !== "send") rows.push(["Also sends", `${formatEth(value)} ETH`]);
    return { kind, danger, title, rows, warnings };
  };

  if (data === "0x") {
    rows.push(["To", tx.to], ["Amount", `${formatEth(value)} ETH`]);
    lookalike(tx.to);
    return done("send", "low", `Send ${formatEth(value)} ETH`);
  }
  // Every token call below needs whole words; anything shorter isn't one.
  const words = (data.length - 10) / 64;

  if (selector === SELECTORS.transfer && words >= 2) {
    const to = wordAddress(data, 0);
    const amount = wordNumber(data, 1);
    rows.push(["To", to], ["Amount", amountOf(amount)], ["Token", token ? symbol : short(tx.to)]);
    lookalike(to);
    if (!token)
      warnings.push(
        `${short(tx.to)} isn't a token Tera knows, so the amount is shown in base units.`,
      );
    return done("transfer", token ? "low" : "unknown", `Send ${amountOf(amount)}`);
  }
  if ((selector === SELECTORS.approve || selector === SELECTORS.increaseAllowance) && words >= 2) {
    const spender = wordAddress(data, 0);
    const amount = wordNumber(data, 1);
    const known = Boolean(spenders[lower(spender)]);
    if (selector === SELECTORS.approve && amount === 0n) {
      rows.push(["Spender", who(spender)], ["Token", symbol]);
      return done("revoke", "low", `Remove ${who(spender)}'s permission to spend ${symbol}`);
    }
    const unlimited = amount >= UNLIMITED_FROM;
    const shown = unlimited ? `Unlimited ${symbol}` : amountOf(amount);
    rows.push(["Lets spend", shown], ["Spender", who(spender)], ["Token", symbol]);
    if (!known)
      warnings.push(
        `The spender ${short(spender)} isn't a contract Tera knows. Make sure you trust this site.`,
      );
    if (unlimited)
      warnings.push(
        "This permission has no limit: the spender can take all of this token, now or later, until you remove it.",
      );
    return done(
      "approve",
      known && !unlimited ? "low" : "high",
      unlimited
        ? `This lets ${who(spender)} spend all of your ${symbol}`
        : `This lets ${who(spender)} spend ${shown}`,
    );
  }
  if (selector === SELECTORS.setApprovalForAll && words >= 2) {
    const operator = wordAddress(data, 0);
    const on = wordNumber(data, 1) !== 0n;
    rows.push(["Operator", who(operator)], ["Collection", short(tx.to)]);
    if (!on) return done("revoke", "low", `Remove ${who(operator)}'s access to this collection`);
    warnings.push(
      "This hands over every item you hold in this collection, now and later, until you remove it.",
    );
    return done(
      "approve-all",
      "high",
      `This lets ${who(operator)} move all your items in this collection`,
    );
  }
  if (selector === SELECTORS.transferFrom && words >= 3) {
    const from = wordAddress(data, 0);
    const to = wordAddress(data, 1);
    rows.push(["From", from], ["To", to], ["Amount", amountOf(wordNumber(data, 2))]);
    lookalike(to);
    warnings.push(
      "This moves tokens using a permission granted earlier. Check the From and To addresses.",
    );
    return done("transfer-from", "unknown", `Move ${amountOf(wordNumber(data, 2))}`);
  }
  rows.push(["Contract", tx.to], ["Function", selector]);
  warnings.push(
    "Tera can't read what this contract call does. Only continue if you trust this site and expected this step.",
  );
  return done(
    "call",
    "unknown",
    value > 0n ? `Send ${formatEth(value)} ETH to a contract` : `Interact with ${short(tx.to)}`,
  );
}

/**
 * Whether the wallet can pay: the fee cap, then amount plus the most the fee
 * can cost. Returns { maxFee (wei, bigint), error? }.
 */
export function feeCheck({ gas, maxFeePerGas, balance, value }) {
  const maxFee = BigInt(gas) * BigInt(maxFeePerGas);
  if (maxFee > FEE_CAP_WEI)
    return {
      maxFee,
      error: `The network fee could reach ${formatEth(maxFee)} ETH, over Tera's 0.001 ETH limit per transaction. Try again when the network is quieter.`,
    };
  if (BigInt(value) + maxFee > BigInt(balance))
    return {
      maxFee,
      error: `Not enough ETH. This needs up to ${formatEth(BigInt(value) + maxFee)} ETH including the network fee, and the wallet has ${formatEth(balance)}.`,
    };
  return { maxFee };
}
