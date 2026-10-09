// Spam tokens: what turns up in a wallet without being asked for, and which
// of it the home screen should leave out. No network access of its own.
//
// Anyone can send any token to any address. Airdropped spam is how phishing
// reaches a wallet: a token named "Claim at usdg-reward.xyz", or a fake USDG
// whose only purpose is to sit next to the real one. Listing every token the
// explorer reports would put those on the home screen; listing only known
// tokens would hide real ones the owner bought elsewhere.
//
// The rules, each one a test:
//
//   A token Tera already knows — built in, in the registry, or imported by
//   the owner — is never spam.
//
//   An unknown token shows only when the explorer prices it, does not flag
//   its reputation, and its name is not an advert. Anything else is hidden.
//
//   A token using the symbol of one Tera knows, from a different contract,
//   is an impostor and is hidden even if priced — two "USDG" rows side by
//   side is the attack. The same goes for a second unknown token with the
//   symbol of one already shown.
//
//   The owner decides last: a token they hide stays hidden, a spam token
//   they choose to show is shown, and either can be undone.

const lower = (value) => String(value ?? "").toLowerCase();

// Links, domains and "claim your reward" copy in a token's name or symbol.
const BAIT =
  /https?:|www\.|\.(com|io|xyz|org|net|app|finance|gift|site|online|top|club|vip|cc|me|link|pro|fi)\b|t\.me|claim|reward|airdrop|visit|bonus|voucher|redeem|giveaway|free\s|eligible/i;

export const REASONS = {
  scam: "Flagged by the block explorer",
  bait: "Its name is an advert or a link",
  impostor: "Copies the name of a token you hold",
  unpriced: "No price and no market",
};

/**
 * Why an unknown token is spam, or null when it may be shown.
 * token: { symbol, name, exchangeRate, reputation }.
 * knownSymbols: upper-case symbols of the tokens Tera already knows.
 */
export function spamReason(token, knownSymbols = new Set()) {
  if (token?.reputation && token.reputation !== "ok") return "scam";
  if (BAIT.test(`${token?.name ?? ""} ${token?.symbol ?? ""}`)) return "bait";
  if (knownSymbols.has(String(token?.symbol ?? "").toUpperCase())) return "impostor";
  const rate = Number(token?.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) return "unpriced";
  return null;
}

/**
 * Sorts the tokens the explorer found into what to add to the wallet's list
 * and what was kept out.
 *
 * found: [{ address, symbol, name, decimals, exchangeRate, reputation, value }]
 * known: [{ address, symbol }] — tokens Tera already lists.
 * allowed: addresses the owner chose to show despite the rules.
 *
 * Returns { show: found tokens to list, spam: [{ ...token, reason }] }.
 * Tokens with a zero balance and tokens already known are in neither.
 */
export function sortFound(found, known = [], allowed = []) {
  const knownAddresses = new Set(known.map((k) => lower(k.address)));
  const knownSymbols = new Set(known.map((k) => String(k.symbol).toUpperCase()));
  const allow = new Set(allowed.map(lower));
  const show = [];
  const spam = [];
  for (const token of found || []) {
    const address = lower(token?.address);
    if (!address || knownAddresses.has(address)) continue;
    if (!(BigInt(token.value ?? 0) > 0n)) continue;
    const reason = spamReason(token, knownSymbols);
    if (!reason || allow.has(address)) {
      show.push(token);
      // The wallet lists one token per symbol; a second one by that name is a copy.
      knownSymbols.add(String(token.symbol).toUpperCase());
    } else spam.push({ ...token, reason });
  }
  return { show, spam };
}

/** The owner's own hide list applied to the home list; returns { shown, hidden }. */
export function applyHidden(rows, hidden = [], addressOf = (row) => row.address) {
  const set = new Set(hidden.map(lower));
  const shown = [];
  const out = [];
  for (const row of rows || []) (set.has(lower(addressOf(row))) ? out : shown).push(row);
  return { shown, hidden: out };
}

/** A list with an address added or removed, lower-cased and without repeats. */
export function toggle(list, address, on) {
  const rest = (list || []).map(lower).filter((a) => a !== lower(address));
  return on ? [...rest, lower(address)] : rest;
}
