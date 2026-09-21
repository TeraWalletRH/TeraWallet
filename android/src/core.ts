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

// What holdings are worth. Shared because the honest part of a valuation is arithmetic,
// not presentation: an unpriced holding must be left out of the total and named, on both
// surfaces, or one of them shows a confident figure that quietly counts it as nothing.
export * as value from "../../public/tera/core/value.js";

// Which of the owner's accounts a party has been able to join up, and the guard
// that stops one request naming two of them.
//
// Shared rather than left to the browser because the rule is the same on both
// surfaces and only the arithmetic of it is hard. This app holds exactly one
// account — one phrase in the keystore — so the pairing half has nothing to
// compare and correctly answers that there is nothing to separate. That is the
// honest answer arriving from the shared vocabulary rather than the phone
// silently not having the concept, and it stops being the answer the day this
// app grows a second account.
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
