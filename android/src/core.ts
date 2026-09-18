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
