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
  const genuine = genuineAddresses(list, trusted);
  const shown = [];
  const hidden = [];
  for (const row of list) {
    if (!row?.fromChain) {
      shown.push(row);
      continue;
    }
    (judge(row.counterpartyAddress, row.amount, genuine) ? hidden : shown).push(row);
  }
  return { shown, hidden };
}

// The genuine address per fingerprint: a trusted one wins, else the first seen.
function genuineAddresses(list, trusted, extra = []) {
  const anchors = new Set(trusted.filter(isAddress).map(lower));
  for (const row of list) if (!row?.fromChain && isAddress(row?.recipient)) anchors.add(lower(row.recipient));
  const genuine = new Map();
  for (const address of anchors) {
    const key = fingerprint(address);
    if (!genuine.has(key)) genuine.set(key, new Set());
    genuine.get(key).add(address);
  }
  const oldestFirst = [...list.filter((row) => row?.fromChain), ...extra]
    .filter((row) => isAddress(row?.counterpartyAddress) && !isZero(row.amount))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const row of oldestFirst) {
    const key = fingerprint(row.counterpartyAddress);
    if (!genuine.has(key)) genuine.set(key, new Set([lower(row.counterpartyAddress)]));
  }
  return genuine;
}

// Why a transfer with `address` is planted, or null when it is not.
function judge(address, amount, genuine) {
  if (isZero(amount)) return { reason: "zero" };
  if (!isAddress(address)) return null;
  const real = genuine.get(fingerprint(address));
  if (!real || real.has(lower(address))) return null;
  return { reason: "lookalike", imitates: [...real][0] };
}

/**
 * Why one explorer row is hidden: { reason: "zero" }, or
 * { reason: "lookalike", imitates } naming the genuine address it copies.
 * Null when the row is not hidden. rows and trusted as for splitPoisoned.
 */
export function reasonFor(row, rows, trusted = []) {
  if (!row?.fromChain) return null;
  return judge(row.counterpartyAddress, row.amount, genuineAddresses(rows || [], trusted));
}

/**
 * Sorts transfers just heard, before any of them is announced.
 *
 * items: { hash, amount, counterparty, counterpartyAddress?, timestamp? };
 *   the full address is counterpartyAddress, else counterparty.
 * rows, trusted: the activity already known, as for splitPoisoned.
 *
 * Returns { genuine, planted, silent }. A lookalike is planted, with the
 * genuine address it imitates, and deserves a warning: someone is waiting
 * for that address to be copied. A zero-value transfer is silent: hidden
 * like the rest, but not worth interrupting anyone for. Among items that
 * are all new, the first seen is the genuine one, as in the activity list.
 */
export function screenAlerts(items, rows, trusted = []) {
  const heard = (items || []).map((item) => ({
    item,
    counterpartyAddress: isAddress(item?.counterpartyAddress) ? item.counterpartyAddress : item?.counterparty,
    amount: item?.amount,
    createdAt: item?.timestamp ?? Number.MAX_SAFE_INTEGER,
  }));
  const genuineSet = genuineAddresses(rows || [], trusted, heard);
  const genuine = [];
  const planted = [];
  const silent = [];
  for (const entry of heard) {
    const why = judge(entry.counterpartyAddress, entry.amount, genuineSet);
    if (!why) genuine.push(entry.item);
    else if (why.reason === "zero") silent.push(entry.item);
    else planted.push({ item: entry.item, address: lower(entry.counterpartyAddress), imitates: why.imitates });
  }
  return { genuine, planted, silent };
}

/**
 * A known address that `address` imitates: one that reads the same at a
 * glance but isn't it. known: [{ address, name }]. The first match, or null.
 * An exact match is the real thing, so it never counts.
 */
export function impersonates(address, known = []) {
  if (!isAddress(address)) return null;
  if (known.some((k) => isAddress(k?.address) && lower(k.address) === lower(address))) return null;
  return known.find((k) => looksAlike(address, k?.address)) || null;
}
