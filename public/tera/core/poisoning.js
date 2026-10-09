// Address poisoning: transfers planted in the activity list so that a
// lookalike address sits right next to a real one, waiting to be copied.
// No network access of its own.
//
// The attack: after you pay 0xAbCd…1234, someone sends you dust — or a zero
// amount, or a fake token that names you as the sender — from 0xAbCd…f9…1234,
// an address made to match the first and last characters. The next time you
// copy "the address I paid last time" from your activity, you copy theirs.
//
// The rules, each one a test:
//
//   Only what the explorer reported can be hidden. Anything this device
//   signed itself is the owner's own record and always shows.
//
//   A zero-value transfer is hidden. It moves nothing, so nobody sends one
//   to pay you; it is there to put an address in your list.
//
//   Two addresses look alike when they share the first and last four hex
//   characters and are not the same address. By chance that is about one in
//   four billion, so a match is deliberate.
//
//   In a group of lookalikes, one is genuine: a saved contact, the wallet
//   itself, or an address this device sent to — and failing those, the one
//   seen first, because a poisoner can only copy an address after it has
//   appeared. Transfers with any other address in the group are hidden,
//   whatever the amount.

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const lower = (value) => String(value ?? "").toLowerCase();
const isAddress = (value) => ADDRESS.test(String(value ?? ""));

export const MATCH_CHARS = 4;

/** The part of an address a glance actually reads: first and last characters. */
export const fingerprint = (address) => {
  const hex = lower(address).slice(2);
  return `${hex.slice(0, MATCH_CHARS)}…${hex.slice(-MATCH_CHARS)}`;
};

/** Different addresses that read the same at a glance. */
export function looksAlike(a, b) {
  if (!isAddress(a) || !isAddress(b) || lower(a) === lower(b)) return false;
  return fingerprint(a) === fingerprint(b);
}

const isZero = (amount) => {
  const text = String(amount ?? "").trim();
  return text !== "" && Number.isFinite(Number(text)) && Number(text) === 0;
};

/**
 * Splits the activity list into what to show and what to hide.
 *
 * rows: activity rows; explorer rows carry `fromChain: true` and
 *   `counterpartyAddress`, rows this device signed carry `recipient`.
 * trusted: addresses known to be genuine — saved contacts, the wallet's own.
 *
 * Returns { shown, hidden }, each in the order given.
 */
export function splitPoisoned(rows, trusted = []) {
  const list = rows || [];
  const anchors = new Set(trusted.filter(isAddress).map(lower));
  for (const row of list) if (!row?.fromChain && isAddress(row?.recipient)) anchors.add(lower(row.recipient));
  // The genuine address per fingerprint: a trusted one wins, else the first seen.
  const genuine = new Map();
  for (const address of anchors) {
    const key = fingerprint(address);
    if (!genuine.has(key)) genuine.set(key, new Set());
    genuine.get(key).add(address);
  }
  const oldestFirst = list
    .filter((row) => row?.fromChain && isAddress(row.counterpartyAddress) && !isZero(row.amount))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const row of oldestFirst) {
    const key = fingerprint(row.counterpartyAddress);
    if (!genuine.has(key)) genuine.set(key, new Set([lower(row.counterpartyAddress)]));
  }
  const shown = [];
  const hidden = [];
  for (const row of list) {
    if (!row?.fromChain) {
      shown.push(row);
      continue;
    }
    const address = lower(row.counterpartyAddress);
    const poisoned =
      isZero(row.amount) ||
      (isAddress(address) && !genuine.get(fingerprint(address))?.has(address));
    (poisoned ? hidden : shown).push(row);
  }
  return { shown, hidden };
}
