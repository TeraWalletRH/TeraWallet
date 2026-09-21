// Whether two of your accounts have been joined up, and by whom.
//
// Every wallet has an account switcher. None of them tell you the thing the
// switcher implies and does not deliver: separate accounts are only separate
// until one party answers for both. The moment a single RPC operator, indexer or
// price API serves account A and then account B from the same browser, that
// party holds the fact that A and B are one person — and nothing on the switcher
// screen ever said so.
//
// `endpoint.js` already pins one operator per account for exactly this reason.
// What was missing is the reading of it: which pairs are still apart, which are
// already joined, and which will join on the next refresh because the assignment
// happened to send both accounts to the same place. That last state is the one
// worth having, because it is the only one an owner can still act on.
//
// Two rules this module is built around, and will not bend:
//
//   A sighting cannot be taken back. An operator that answered for an account a
//   minute ago does not forget it when you switch away. So the ledger here only
//   ever grows within a page session, and a pair that has been linked stays
//   linked on this screen even after the pool is changed. Showing it recovering
//   would be a lie in the one direction that matters.
//
//   Isolation that some party sees through is not isolation. Tera's own service
//   is fetched by address for every account, and every request from this browser
//   carries the same network address whoever is connected. Those parties see
//   every pair, always. They are named in `STRUCTURAL` and repeated inside the
//   sentence for a separated pair, so no surface can render the good word
//   without them.
//
// What is actually being tracked, and where it lives: a list of the accounts
// this browser has connected in this page session, and per account the parties
// that have answered for it. In page memory only — never the vault, never
// localStorage. A stored list of an owner's accounts, with a record of which
// operator saw which, is precisely the artefact this feature exists to stop
// other people building. It is not one worth building here either, and a reload
// empties it.

/** A party has answered for both accounts. Already joined, and not undoable. */
export const LINKED = "linked";
/**
 * Both accounts are assigned to the same party, and it has not yet answered for
 * both. The one state that is still a decision rather than a fact.
 */
export const WOULD_LINK = "would-link";
/** Different parties, and no party has answered for both. Bounded by `STRUCTURAL`. */
export const SEPARATED = "separated";

/** Worst first, the way `verdict.js` orders its four. */
export const ORDER = [LINKED, WOULD_LINK, SEPARATED];

export const LABELS = {
  [LINKED]: "Linked",
  [WOULD_LINK]: "Links on next read",
  [SEPARATED]: "Not joined here",
};

/**
 * The parties that see every account regardless of how the pool is arranged.
 *
 * Deliberately not scored. If these counted toward a pair's state then every
 * pair would read LINKED forever, the screen would say the same thing about
 * every arrangement, and the part an owner can still change would be invisible
 * inside it. They are reported beside the state instead, and inside the sentence
 * for the one state that could be misread as safety.
 */
export const STRUCTURAL = [
  {
    party: "Tera service API",
    why: "Each account is registered and fetched by its address, so the service holds every account you connect.",
  },
  {
    party: "Your network address",
    why: "Every request from this browser comes from the same address, whichever account is connected.",
  },
  {
    party: "Your wallet extension",
    why: "It holds the keys for all of them and signs for each one, and it chose the provider the signing path uses.",
  },
];

/** What this screen does not establish, for the panel that offers it. */
export const LIMITS = [
  "Only this page session is counted. A reload empties the ledger — not because the operators forget, but because keeping a list of your accounts and who saw them would be the same record this is meant to prevent.",
  "Only what this page can see is counted. Reads your wallet extension makes, requests from another tab, and anything you did before this page opened are not in it.",
  "Operators that compare notes are not separated by any of this. Every read comes from one network address, so two operators who pool what they hold can rejoin the accounts between them.",
  "A pair that reads as not joined is only not joined at the balance-read operators. Tera's service, your network address and your wallet extension see every pair, always.",
  "Changing the pool does not unlink a pair. A party that has answered for two of your accounts keeps that, and this screen keeps showing it.",
];

const keyOf = (account) =>
  String(account ?? "")
    .trim()
    .toLowerCase();

/** `0x1234…cdef`. Enough to tell two accounts apart, short enough to sit in a table. */
export const shortAccount = (account) => {
  const key = keyOf(account);
  return key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key;
};

/** A ledger with nothing in it. The state every page load starts from. */
export const emptyLedger = () => ({ accounts: [], seen: {} });

/**
 * Note that an account was connected, without yet claiming anybody read it.
 *
 * Connecting is worth recording on its own: a pair of accounts that have both
 * been connected but not yet read is the case where the forecast is useful, and
 * without this the second account would not appear until a read had already
 * happened — which is after the only moment an owner could have acted.
 */
export function noteAccount(ledger = emptyLedger(), account) {
  const key = keyOf(account);
  if (!key || ledger.accounts.includes(key)) return ledger;
  return { accounts: [...ledger.accounts, key], seen: ledger.seen };
}

/**
 * Note that `party` answered for `account`.
 *
 * Returns the same ledger object when there is nothing new, so a surface can use
 * identity to decide whether anything changed.
 */
export function noteRead(ledger = emptyLedger(), account, party) {
  const key = keyOf(account);
  const name = String(party ?? "").trim();
  if (!key || !name) return ledger;
  const parties = ledger.seen[key] || [];
  if (parties.includes(name)) return noteAccount(ledger, account);
  const withAccount = noteAccount(ledger, account);
  return {
    accounts: withAccount.accounts,
    seen: { ...withAccount.seen, [key]: [...parties, name] },
  };
}

/** The parties that have answered for one account, in the order they first did. */
export const partiesFor = (ledger, account) => ledger?.seen?.[keyOf(account)] || [];

/**
 * The state of one pair.
 *
 * `assign` maps an account to the party that would read it next — the pool
 * assignment, or the wallet's own provider when no pool is set. It is passed in
 * rather than imported because the assignment lives in `endpoint.js`, on the
 * wallet side of the line, and the core does not reach that way.
 *
 * A pair with no forecast and no shared sighting is separated, which is the
 * honest reading: nothing has joined them here, and `STRUCTURAL` says who
 * already has.
 */
export function pairingOf(ledger, a, b, assign = () => null) {
  const accounts = [keyOf(a), keyOf(b)];
  const left = partiesFor(ledger, a);
  const right = partiesFor(ledger, b);
  const shared = left.filter((party) => right.includes(party));
  const forecast = [assign(accounts[0]), assign(accounts[1])];
  // Only a forecast onto a party that is not already in `shared` is news. When it
  // is, the pair is linked and saying it is about to be adds nothing.
  const pending =
    forecast[0] && forecast[0] === forecast[1] && !shared.includes(forecast[0]) ? forecast[0] : "";
  return {
    accounts,
    state: shared.length ? LINKED : pending ? WOULD_LINK : SEPARATED,
    shared,
    pending,
  };
}

/** Every pair of accounts this session has seen, worst first. */
export function pairings(ledger = emptyLedger(), assign = () => null) {
  const list = [];
  const accounts = ledger.accounts || [];
  for (let i = 0; i < accounts.length; i += 1)
    for (let j = i + 1; j < accounts.length; j += 1)
      list.push(pairingOf(ledger, accounts[i], accounts[j], assign));
  return list.sort((one, two) => ORDER.indexOf(one.state) - ORDER.indexOf(two.state));
}

/** Counted rather than asserted, so the headline cannot drift from the table. */
export function separationSummary(ledger = emptyLedger(), assign = () => null) {
  const pairs = pairings(ledger, assign);
  const count = (state) => pairs.filter((pair) => pair.state === state).length;
  return {
    accounts: (ledger.accounts || []).length,
    pairs: pairs.length,
    linked: count(LINKED),
    wouldLink: count(WOULD_LINK),
    separated: count(SEPARATED),
  };
}

/**
 * Whether the pool is even large enough to keep the accounts in use apart.
 *
 * Pigeonhole, and worth saying out loud rather than leaving an owner to work out
 * from a table: with more accounts than operators, some pair must share one. No
 * assignment avoids it, no reshuffle fixes it, and somebody looking at three
 * linked pairs deserves to know the cause is arithmetic rather than bad luck.
 *
 * `parties` is the number of distinct operators in the pool — the count
 * `poolSummary` reports, not the number of URLs, because two endpoints at one
 * company add no capacity at all.
 */
export function capacity(accounts = 0, parties = 0) {
  if (accounts < 2) return { enough: true, note: "" };
  if (parties < 2)
    return {
      enough: false,
      note: `One party reads all ${accounts} of your accounts, so every pair is joined at it. Separation starts at two operators run by different companies.`,
    };
  if (accounts > parties)
    return {
      enough: false,
      note: `${accounts} accounts across ${parties} operators means at least one pair has to share one — that is arithmetic, not the assignment being unlucky, and no reshuffle avoids it. Keeping every pair apart takes ${accounts} operators.`,
    };
  return {
    enough: true,
    note: `${parties} operators for ${accounts} accounts is enough for every pair to be read by a different one. Whether they are is the table above, not this line: assignment is a hash, so it can still land two accounts on the same operator.`,
  };
}

/**
 * The sentence under a pair.
 *
 * Written here rather than at the surface for the reason `value.js` gives about
 * its own summary: two places drawing the same result is two chances for one of
 * them to word it more kindly, and the kind wording is the one that gets read.
 * The caveat on a separated pair is inside the sentence, not beside it.
 */
export function describePair(pairing = {}) {
  if (pairing.state === LINKED)
    return `${pairing.shared.join(", ")} ${pairing.shared.length === 1 ? "has" : "have"} answered for both of these accounts, so ${pairing.shared.length === 1 ? "it holds" : "they hold"} the fact that they are one person. That cannot be taken back, and changing the pool now will not.`;
  if (pairing.state === WOULD_LINK)
    return `Both accounts are assigned to ${pairing.pending}, so the next balance read on the second one joins them there. Add an endpoint run by a different company, and they will be assigned apart before that happens.`;
  return "No balance-read operator has answered for both of these. Tera's service, your network address and your wallet extension still see both, as they do for every account.";
}

// ---------------------------------------------------------------------------
// The other half: one request, at most one account.
//
// The ledger above describes correlation that happened a party at a time. A
// single request that names two accounts does it in one step, to whoever
// receives it, permanently and with no ambiguity about whether the two were the
// same person — the request itself is the proof.
//
// This is not hypothetical, and it is not rare. Bridging or sending from one of
// your accounts to another one is an ordinary thing to want, and the body that
// does it carries `ownerAddress` and `recipient` together. No amount of endpoint
// isolation survives that request, and no pool arrangement is even consulted.
//
// So it is refused by default, at the one place every service request goes
// through. An owner who actually meant it can say so — this is a legitimate
// action and blocking it outright with no way forward would just be a wallet
// that appears broken — but it is a decision they make with the cost in front of
// them, once, rather than one the wallet makes for them silently.
// ---------------------------------------------------------------------------

const ADDRESS = /0x[0-9a-fA-F]{40}/g;

/**
 * Every known account named anywhere in a payload, in the order the ledger has
 * them, with no duplicates.
 *
 * The whole payload is walked rather than a list of address-shaped field names,
 * because the field that carries the second account is exactly the field nobody
 * thought of. Strings are matched anywhere inside, so an address in a path, a
 * memo or a nested object counts the same as one in `recipient`.
 */
export function accountsNamed(payload, accounts = []) {
  const known = new Set(accounts.map(keyOf).filter(Boolean));
  if (!known.size) return [];
  const found = new Set();
  const walk = (value, depth = 0) => {
    if (depth > 8 || found.size === known.size) return;
    if (typeof value === "string") {
      for (const match of value.match(ADDRESS) || []) {
        const key = keyOf(match);
        if (known.has(key)) found.add(key);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (value && typeof value === "object")
      for (const item of Object.values(value)) walk(item, depth + 1);
  };
  walk(payload);
  return accounts.map(keyOf).filter((key) => found.has(key));
}

/**
 * Whether one request would tell its recipient that two of your accounts belong
 * to the same person, and what to say if it would.
 *
 * `named` is the accounts found. `spans` is true only for two or more: a request
 * that carries one account is what almost every request here is, and calling
 * that a correlation would make the refusal meaningless by firing on everything.
 */
export function spanOf(payload, accounts = []) {
  const named = accountsNamed(payload, accounts);
  if (named.length < 2) return { spans: false, named, reason: "" };
  return {
    spans: true,
    named,
    reason: `This request names ${named.length} of your accounts — ${named.map(shortAccount).join(" and ")} — in one message. Sending it tells whoever receives it that they belong to the same person, in a way no endpoint arrangement undoes and nothing later retracts. It was not sent.`,
  };
}

/** What an owner is told when they are about to allow one anyway. */
export const SPAN_CONSENT =
  "Allowing this makes the link at Tera's service directly and permanently, for every request in this session that names two of your accounts. It stays off until you turn it on and goes back off when the page reloads.";
