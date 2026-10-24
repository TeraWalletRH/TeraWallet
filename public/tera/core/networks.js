// Custom networks: an EVM chain the owner adds by hand, beyond the ones Tera
// ships with.
//
// Tera is built around one chain, Robinhood Chain, and that does not change
// here: a custom network is never offered anywhere a transfer, swap, bridge
// or sign happens, and nothing here can make Tera read a balance from one —
// this module only validates and stores what the owner typed. What it is for
// is the owner's own reference: an RPC URL and chain ID worth keeping next to
// the wallet that might need them, open in a block explorer, or hand to
// another tool, the same way a browser's own bookmark does not run anything
// either.
//
// The list is private and local, written into the owner's encrypted data on
// this device and never sent to Tera.

/** Robinhood Chain's own id. A custom entry claiming it would be confusing, not useful. */
export const ROBINHOOD_CHAIN_ID = 4663;

/** The published limits, quoted in the form and in the tests. */
export const LIMITS = {
  maxNetworks: 20,
  maxName: 32,
  maxSymbol: 10,
};

const SYMBOL = /^[A-Za-z0-9]{1,10}$/;

/** Whether a string is an https URL. Plain and deliberate: no http, no other scheme. */
function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.startsWith("https://")) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Keep only well-formed entries. What a stored list means, whatever it held. */
export function cleanNetworks(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const chainId = Number(entry?.chainId);
    const name = String(entry?.name ?? "").trim().slice(0, LIMITS.maxName);
    const symbol = String(entry?.symbol ?? "").trim().toUpperCase();
    if (
      !Number.isSafeInteger(chainId) ||
      chainId <= 0 ||
      chainId === ROBINHOOD_CHAIN_ID ||
      seen.has(chainId) ||
      !name ||
      !isHttpsUrl(entry?.rpcUrl) ||
      !SYMBOL.test(symbol)
    )
      continue;
    const explorerUrl = isHttpsUrl(entry?.explorerUrl) ? entry.explorerUrl : "";
    seen.add(chainId);
    out.push({
      chainId,
      name,
      rpcUrl: entry.rpcUrl,
      symbol,
      explorerUrl,
      addedAt: Number.isSafeInteger(entry?.addedAt) ? entry.addedAt : 0,
    });
    if (out.length >= LIMITS.maxNetworks) break;
  }
  return out;
}

/**
 * Add a network, or update one already added at the same chain ID.
 *
 * Returns `{ ok, list, entry, reason }` rather than throwing, because it runs
 * as the owner types. The list passed in is not changed.
 */
export function addNetwork(list, { chainId, name, rpcUrl, symbol, explorerUrl = "", now = Date.now() }) {
  const current = cleanNetworks(list);
  const fail = (reason) => ({ ok: false, list: current, entry: null, reason });

  const id = Number(chainId);
  if (!Number.isSafeInteger(id) || id <= 0) return fail("Enter a valid chain ID.");
  if (id === ROBINHOOD_CHAIN_ID)
    return fail("That is Robinhood Chain's own chain ID. Tera already has this network.");

  const trimmedName = String(name ?? "").trim();
  if (!trimmedName) return fail("Enter a name.");
  if (trimmedName.length > LIMITS.maxName)
    return fail(`A name is at most ${LIMITS.maxName} characters.`);

  if (!isHttpsUrl(rpcUrl)) return fail("Enter an https:// RPC URL.");

  const trimmedSymbol = String(symbol ?? "").trim().toUpperCase();
  if (!SYMBOL.test(trimmedSymbol))
    return fail(`The currency symbol is 1-${LIMITS.maxSymbol} letters or numbers.`);

  if (explorerUrl && !isHttpsUrl(explorerUrl)) return fail("The explorer URL must be https://.");

  const existing = current.find((entry) => entry.chainId === id);
  if (!existing && current.length >= LIMITS.maxNetworks)
    return fail(`You can add up to ${LIMITS.maxNetworks} networks. Remove one first.`);

  const entry = {
    chainId: id,
    name: trimmedName,
    rpcUrl,
    symbol: trimmedSymbol,
    explorerUrl: explorerUrl || "",
    addedAt: existing?.addedAt || now,
  };
  const next = existing
    ? current.map((item) => (item.chainId === id ? entry : item))
    : [...current, entry];
  return { ok: true, list: next, entry, reason: "" };
}

/** The list without this chain ID. Removing an unknown one is not an error. */
export function removeNetwork(list, chainId) {
  const id = Number(chainId);
  return cleanNetworks(list).filter((entry) => entry.chainId !== id);
}

/** Added networks sorted by name, for a list the owner scans. */
export const sortedNetworks = (list) =>
  [...cleanNetworks(list)].sort((a, b) => a.name.localeCompare(b.name));

export const PRIVACY_NOTE =
  "Saved only on this device. A custom network is never used to send, swap, bridge or sign here -- it is a reference you can open in a block explorer or copy elsewhere.";
