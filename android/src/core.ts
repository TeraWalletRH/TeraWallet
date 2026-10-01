// The shared core, as this app sees it.
//
// One import site rather than a relative path scattered through the codebase:
// the path crosses out of the Expo project and into public/tera/core/, which is
// surprising enough to be worth explaining exactly once.
//
// Nothing is reimplemented here. If a rule or a sentence needs to change, it
// changes in the core and both surfaces change together — that is the whole
// point of the arrangement.

export * as minimise from "../../public/tera/core/minimise.js";
export * as ingress from "../../public/tera/core/ingress.js";
export * as receipt from "../../public/tera/core/receipt.js";
export * as parse from "../../public/tera/core/parse.js";
export * as tags from "../../public/tera/core/tags.js";
// Names the owner gives addresses they send to. Kept on the device only.
export * as contacts from "../../public/tera/core/contacts.js";

// What holdings are worth. Shared because the honest part of a valuation is arithmetic,
// not presentation: an unpriced holding must be left out of the total and named, on both
// surfaces, or one of them shows a confident figure that quietly counts it as nothing.
export * as value from "../../public/tera/core/value.js";

// Which of the owner's accounts a party has been able to join up, and the guard
// that stops one request naming two of them.
//
// Shared rather than left to the browser because the rule is the same on both
// surfaces and only the arithmetic of it is hard.
//
// This app now has more than one wallet, so the pairing half has something to
// compare — but nothing here draws it yet. Balances on this device are read over
// one connection to the network the app ships with, which answers for every
// wallet, so every pair would report as linked at that one operator. A screen
// saying so is worth building once the phone can point reads somewhere else;
// until then it would be a panel with one unchanging answer.
export * as linkage from "../../public/tera/core/linkage.js";

// Re-exported by name because validation.ts and App.tsx use these directly and
// a namespace would read worse at every call site.
export {
  PASS,
  FAIL,
  UNVERIFIABLE,
  SKIPPED,
  labelFor,
  gateVerdicts,
  summarise,
  clean,
  blockers,
  blockingReason,
} from "../../public/tera/core/verdict.js";

// The approved-build registry. The phone is in the same position as the browser
// here — it fetches its own copy, so a match is not a second opinion — but the
// module is shared so both say the same thing about that rather than one of
// them quietly claiming more.
export {
  parseRegistry,
  verifyRegistry,
  releaseCheck,
  lookup,
  FROM_PAGE,
  INDEPENDENT,
  LIMITS as REGISTRY_LIMITS,
} from "../../public/tera/core/registry.js";

export * as nft from "../../public/tera/core/nft.js";

// Paying a dollar amount in USDG, and topping up from ETH when the dollars are short.
export * as spend from "../../public/tera/core/spend.js";

// Caps on what the wallet pays out through Tera, per payment, per day and per month.
export * as limits from "../../public/tera/core/limits.js";

// Searching and filtering the activity list by address, name, hash, asset, type, status and date.
export * as activitySearch from "../../public/tera/core/activity-search.js";

// How fast the network is right now, and how long a transaction took to confirm.
export * as networkSpeed from "../../public/tera/core/network-speed.js";

// Private notes on transactions, by hash.
export * as notes from "../../public/tera/core/notes.js";

// What the screen shows and what it holds back: small balances, privacy mode.
export * as discretion from "../../public/tera/core/discretion.js";

// Warns when the address being paid starts and ends like a known one but is not it.
export * as lookalike from "../../public/tera/core/lookalike.js";

// Paying several people in one review, from a pasted list or a CSV.
export * as batch from "../../public/tera/core/batch.js";
