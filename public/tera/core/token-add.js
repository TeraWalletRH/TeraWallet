// A site asking the wallet to show a token (wallet_watchAsset, EIP-747). No
// platform API of its own; extension/src/background.ts reads the chain and
// opens the window, and these are the rules. Each one is a test:
//
//   Only ERC-20 tokens, with a real contract address, a short plain symbol
//   and whole-number decimals from 0 to 36. Anything else is refused before
//   a window opens.
//
//   The site's word is never taken. The token's own symbol(), name() and
//   decimals() are read from Robinhood Chain, and those are what's shown and
//   kept. An address that doesn't answer like a token is refused, and so is
//   a site whose decimals disagree with the token's, since amounts would
//   read wrong by powers of ten.
//
//   No lookalikes. A token using the symbol of one Tera already lists (a
//   second "USDG") is refused: fake tokens copy real names, and two rows
//   with the same name is exactly the confusion they rely on.
//
//   A token Tera already lists needs no window: the answer is yes at once.
//
//   Added tokens are only shown, never trusted: they aren't priced, they
//   aren't offered for swaps, and a site's image is never loaded.

import { ERRORS, rpcError } from "./dapp-connect.js";

export const SELECTORS = { symbol: "0x95d89b41", name: "0x06fdde03", decimals: "0x313ce567" };
export const MAX_ADDED = 50;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SYMBOL = /^[A-Za-z0-9.$_-]{1,12}$/;
const lower = (value) => String(value ?? "").toLowerCase();

/** The token a wallet_watchAsset request names, or the error refusing it. */
export function readWatchAsset(params) {
  const request = Array.isArray(params) ? params[0] : params;
  if (!request || typeof request !== "object")
    return { error: rpcError(ERRORS.invalidParams, "Expected { type, options }.") };
  if (String(request.type).toUpperCase() !== "ERC20")
    return { error: rpcError(ERRORS.invalidParams, "Tera adds ERC-20 tokens only.") };
  const options = request.options ?? {};
  const address = String(options.address ?? "").trim();
  if (!ADDRESS.test(address) || /^0x0{40}$/i.test(address))
    return { error: rpcError(ERRORS.invalidParams, "That isn't a token address.") };
  const symbol = String(options.symbol ?? "").trim();
  if (!SYMBOL.test(symbol))
    return {
      error: rpcError(ERRORS.invalidParams, "A token symbol is 1 to 12 letters and numbers."),
    };
  const decimals = Number(options.decimals);
  if (
    options.decimals === undefined ||
    options.decimals === null ||
    options.decimals === "" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  )
    return { error: rpcError(ERRORS.invalidParams, "Decimals must be a whole number, 0 to 36.") };
  return { token: { address: lower(address), symbol, decimals } };
}

/** An ABI-encoded string (or a bytes32, as old tokens return), or null. */
export function decodeAbiString(hex) {
  const data = String(hex ?? "").replace(/^0x/, "");
  if (!/^[0-9a-fA-F]*$/.test(data) || data.length < 64) return null;
  const text = (bytes) => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      return null;
    }
  };
  const byteAt = (at, count) =>
    Array.from({ length: count }, (_, i) => parseInt(data.slice(at + i * 2, at + i * 2 + 2), 16));
  if (data.length === 64) {
    // bytes32: the text, padded with zeros.
    const bytes = byteAt(0, 32);
    const end = bytes.indexOf(0);
    return text(end === -1 ? bytes : bytes.slice(0, end));
  }
  const offset = Number.parseInt(data.slice(0, 64), 16);
  if (!Number.isSafeInteger(offset) || offset * 2 + 64 > data.length) return null;
  const length = Number.parseInt(data.slice(offset * 2, offset * 2 + 64), 16);
  if (!Number.isSafeInteger(length) || offset * 2 + 64 + length * 2 > data.length) return null;
  return text(byteAt(offset * 2 + 64, length));
}

/** decimals() as a number, or null. */
export function decodeDecimals(hex) {
  const data = String(hex ?? "").replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(data.slice(0, 64))) return null;
  const value = BigInt(`0x${data.slice(0, 64)}`);
  return value <= 36n ? Number(value) : null;
}

/**
 * The token as it'll be kept, or why it won't be. `onChain` is what the
 * contract answered ({ symbol, name, decimals }, each null if it didn't);
 * `listed` is what Tera lists already.
 */
export function checkToken({ token, onChain, listed = [] }) {
  const refuse = (message) => ({ error: rpcError(ERRORS.invalidParams, message) });
  if (!onChain || onChain.decimals === null || onChain.decimals === undefined || !onChain.symbol)
    return refuse("That address doesn't answer like a token on Robinhood Chain.");
  if (onChain.decimals !== token.decimals)
    return refuse(
      `The site says ${token.symbol} has ${token.decimals} decimals, but the token says ${onChain.decimals}. Tera won't add it.`,
    );
  const symbol = String(onChain.symbol).trim();
  if (!SYMBOL.test(symbol))
    return refuse("This token's symbol has characters Tera won't show. Tera won't add it.");
  const twin = listed.find(
    (asset) => lower(asset.symbol) === lower(symbol) && lower(asset.address) !== token.address,
  );
  if (twin)
    return refuse(
      `Tera already lists ${twin.symbol} at ${twin.address}. This is a different token using its name, so Tera won't add it.`,
    );
  const warnings = [
    "Tera doesn't know this token. Anyone can make a token with any name; adding it only shows its balance here.",
  ];
  if (lower(symbol) !== lower(token.symbol))
    warnings.unshift(
      `The site called it ${token.symbol}, but the token calls itself ${symbol}. Tera shows the token's own name.`,
    );
  const name =
    String(onChain.name ?? "")
      .trim()
      .slice(0, 60) || symbol;
  return { asset: { address: token.address, symbol, name, decimals: token.decimals }, warnings };
}

/** Added tokens as stored: well-formed entries only, each once. */
export function cleanAdded(list) {
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!entry || !ADDRESS.test(String(entry.address)) || !SYMBOL.test(String(entry.symbol)))
      continue;
    if (!Number.isInteger(entry.decimals) || entry.decimals < 0 || entry.decimals > 36) continue;
    const address = lower(entry.address);
    if (seen.has(address)) continue;
    seen.add(address);
    out.push({
      address,
      symbol: entry.symbol,
      name: String(entry.name ?? entry.symbol).slice(0, 60),
      decimals: entry.decimals,
      added: true,
    });
  }
  return out.slice(0, MAX_ADDED);
}

/** The list with `asset` added (or kept, if it's there). Throws when it's full. */
export function addToken(list, asset) {
  const now = cleanAdded(list);
  if (now.some((entry) => entry.address === lower(asset.address))) return now;
  if (now.length >= MAX_ADDED)
    throw new Error(`Tera shows up to ${MAX_ADDED} added tokens. Remove one in Settings first.`);
  return cleanAdded([...now, asset]);
}

export const removeToken = (list, address) =>
  cleanAdded(list).filter((entry) => entry.address !== lower(address));
