// Lookalike addresses: the address-poisoning warning.
//
// The scam: someone sends the owner a worthless transfer from an address made
// to share the first and last few characters with one the owner really pays —
// 0x5b27…9f05 and 0x5b27…9f05 look the same in a shortened list. The next time
// the owner copies "the last address I paid" from their history, they copy the
// scammer's, and the payment goes there.
//
// The defence is to compare, before review, the address being paid with every
// address the owner already knows — contacts, past payees, past counterparties,
// their own wallets. Same address: fine. Different address that starts and ends
// like a known one: stop and show the two side by side, with the characters
// that differ marked, and let the owner pick the one they meant.
//
// Two random addresses share 3 leading and 3 trailing hex characters about
// once in 16 million; a match that close to a known address is not chance.

const ADDRESS = /^0x[0-9a-f]{40}$/;

/** Leading characters two hex bodies share. */
function sharedStart(a, b) {
  let n = 0;
  while (n < a.length && a[n] === b[n]) n++;
  return n;
}
/** Trailing characters two hex bodies share. */
function sharedEnd(a, b) {
  let n = 0;
  while (n < a.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/**
 * Whether `a` looks like `b` without being it: both ends shared, at least 3
 * characters each and 8 together — what a shortened address shows.
 */
export function looksLike(a, b) {
  const x = String(a ?? "").toLowerCase();
  const y = String(b ?? "").toLowerCase();
  if (!ADDRESS.test(x) || !ADDRESS.test(y) || x === y) return false;
  const start = sharedStart(x.slice(2), y.slice(2));
  const end = sharedEnd(x.slice(2), y.slice(2));
  return start >= 3 && end >= 3 && start + end >= 8;
}

/**
 * The known address `address` is a lookalike of, or null.
 *
 * `known`: [{ address, label }] — the label says where it is known from
 * ("Mum", "paid on 3 Sep"). An exact match anywhere in `known` means the
 * address itself is known, and nothing is flagged. The closest lookalike wins.
 */
export function findLookalike(address, known) {
  const target = String(address ?? "").toLowerCase();
  if (!ADDRESS.test(target)) return null;
  const list = (known || []).filter((k) => ADDRESS.test(String(k?.address ?? "").toLowerCase()));
  if (list.some((k) => k.address.toLowerCase() === target)) return null;
  let best = null;
  let bestScore = -1;
  for (const k of list) {
    const other = k.address.toLowerCase();
    if (!looksLike(target, other)) continue;
    const score = sharedStart(target.slice(2), other.slice(2)) + sharedEnd(target.slice(2), other.slice(2));
    if (score > bestScore) {
      best = { address: k.address, label: k.label || "" };
      bestScore = score;
    }
  }
  return best;
}

/**
 * The address cut into runs that match `other` and runs that do not, for
 * showing two addresses one above the other with the differences marked.
 */
export function diff(address, other) {
  const a = String(address ?? "");
  const b = String(other ?? "").toLowerCase();
  const runs = [];
  for (let i = 0; i < a.length; i++) {
    const same = a[i].toLowerCase() === b[i];
    const last = runs[runs.length - 1];
    if (last && last.same === same) last.text += a[i];
    else runs.push({ text: a[i], same });
  }
  return runs;
}

/** What the warning says, in plain words. */
export const WARNING =
  "This address starts and ends like one you've used before, but it is a different address. Scammers create lookalike addresses and send you a small transfer so you copy theirs from your history by mistake.";
