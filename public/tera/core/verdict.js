// Four states, one vocabulary, both surfaces.
//
// A check has always had three outcomes here: it passed, it blocked, or it did
// not run. The missing fourth is the one that matters most — a check that
// reports a pass it did not actually establish.
//
// `checks.js` already knew about it. Its `gateNuance` says, in as many words,
// "Passed on the registry entry alone: the on-chain contract check was
// unavailable, so transferability is unverified" — and then reports the gate as
// PASS, with that sentence in a different field, in smaller type. The Android
// app did not know about it at all: five booleans, and a review sheet that told
// the owner "Five service checks passed; transaction verified locally."
//
// Both statements can be false at the moment they are shown. This module is
// what makes the weaker outcome a state of its own, so a surface has to render
// it rather than choose whether to mention it.
//
// The states are ordered by what an owner needs to see first, not
// alphabetically and not by how good they look:
//
//   fail          checked, and the answer was no
//   unverifiable  reported as satisfied, but the thing that would establish it
//                 was unavailable. Not a failure, and not a pass.
//   pass          checked, and the answer was yes
//   skipped       not run, or not applicable here
//
// `unverifiable` is deliberately not called "warning". A warning is advice
// about something known; this is the absence of knowledge, and the two lead to
// different decisions.

export const PASS = "pass";
export const FAIL = "fail";
export const UNVERIFIABLE = "unverifiable";
export const SKIPPED = "skipped";

/** Worst first. Anything summarising a set reports in this order. */
export const ORDER = [FAIL, UNVERIFIABLE, PASS, SKIPPED];

/**
 * Wording per context. The same four states mean the same four things
 * everywhere, but "blocked" is the honest word for a gate that said no and
 * "failed" is the honest word for a hash that did not match.
 */
export const LABELS = {
  gate: {
    // "Pass" rather than "Passed" so the uppercased form stays the "PASS" this
    // wallet has always shown. The word is not the point of this build; the
    // fourth state beside it is.
    [PASS]: "Pass",
    [FAIL]: "Blocked",
    [UNVERIFIABLE]: "Unproven",
    [SKIPPED]: "Not run",
  },
  receipt: {
    [PASS]: "Pass",
    [FAIL]: "Failed",
    [UNVERIFIABLE]: "Unproven",
    [SKIPPED]: "Not applicable",
  },
};

export function labelFor(status, context = "gate") {
  return (LABELS[context] || LABELS.gate)[status] || status;
}

/**
 * The conditions under which a reported pass has not been established.
 *
 * Each entry names the field the service sets and what its presence means. They
 * are listed rather than buried in an `if` because this is the part of the file
 * someone will come back to when the service grows a new fallback: a new way to
 * pass without checking belongs here, or it will silently read as a pass.
 */
export const HOLLOW = [
  {
    id: "rpcFallback",
    when: (details) => details.rpcFallback === true,
    detail:
      "Passed on the registry entry alone. The on-chain contract check was unavailable, so whether this asset can actually be transferred is unverified.",
  },
  {
    id: "canTransferUnknown",
    when: (details) => details.canTransfer === "unknown",
    detail:
      "The issuer's transfer restrictions could not be read. A pass here does not establish that this transfer is permitted.",
  },
  {
    id: "staleQuote",
    when: (details) => details.quoteAge === "unknown" || details.staticDefaults === true,
    detail:
      "The figures behind this check are static defaults, not a live quote. They are not evidence about your action.",
  },
];

/**
 * Read one gate result into a verdict.
 *
 * `gate` is what the service returned for a single check. Anything missing is
 * reported as not run rather than assumed either way — a gate absent from the
 * response is not a gate that passed.
 */
export function gateVerdict(gate) {
  if (!gate || typeof gate !== "object")
    return { status: SKIPPED, detail: "This check was not run.", hollow: "" };
  if (!gate.passed)
    return {
      status: FAIL,
      detail: gate.reason || "This check blocked the action.",
      hollow: "",
    };
  const details = gate.details && typeof gate.details === "object" ? gate.details : {};
  const hollow = HOLLOW.find((entry) => entry.when(details));
  if (hollow) return { status: UNVERIFIABLE, detail: hollow.detail, hollow: hollow.id };
  return { status: PASS, detail: gate.reason || "", hollow: "" };
}

/**
 * Every gate in order, as verdicts. `names` fixes the order and the count.
 *
 * When a response carries more than one row for the same gate — which is
 * malformed, and therefore exactly when care is worth taking — the worst of
 * them wins. Reading the first would let a second, weaker result hide behind a
 * clean one that happened to be listed earlier.
 */
export function gateVerdicts(gates, names) {
  const rows = Array.isArray(gates) ? gates : [];
  return names.map((name) => {
    const found = rows.filter((row) => row && row.gate === name);
    if (!found.length) return { gate: name, ...gateVerdict(undefined) };
    const verdicts = found.map(gateVerdict);
    const severity = worst(verdicts);
    return { gate: name, ...verdicts.find((entry) => entry.status === severity) };
  });
}

/** Counts by state, plus the one state that should colour a summary. */
export function tally(verdicts = []) {
  const counts = { [PASS]: 0, [FAIL]: 0, [UNVERIFIABLE]: 0, [SKIPPED]: 0 };
  for (const entry of verdicts) if (entry?.status in counts) counts[entry.status] += 1;
  return counts;
}

/**
 * The worst state present, which is what a headline must reflect.
 *
 * A set containing one blocked check is a blocked set, however many passed.
 */
export function worst(verdicts = []) {
  const counts = tally(verdicts);
  return ORDER.find((status) => counts[status] > 0) || SKIPPED;
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * One sentence for a set of verdicts.
 *
 * This replaces "Five service checks passed" — a sentence that was written once
 * and then said regardless of what happened. Nothing here is conditional on
 * looking good: the unproven count is named whenever it is not zero, because
 * that is the case the old sentence hid.
 */
export function summarise(verdicts = [], { context = "gate" } = {}) {
  const counts = tally(verdicts);
  const total = verdicts.length;
  if (!total) return { status: SKIPPED, line: "No checks ran." };
  const status = worst(verdicts);

  if (counts[FAIL])
    return {
      status,
      line: `${plural(counts[FAIL], "check", "checks")} blocked this action. Nothing will be prepared until that changes.`,
    };
  if (counts[UNVERIFIABLE])
    return {
      status,
      line: `${plural(counts[PASS], "check", "checks")} passed, and ${plural(counts[UNVERIFIABLE], "could not be established", "could not be established")}. Read the unproven ${counts[UNVERIFIABLE] === 1 ? "one" : "ones"} before you approve.`,
    };
  if (counts[SKIPPED] && !counts[PASS]) return { status, line: "No check has run yet." };
  if (counts[SKIPPED])
    return {
      status: PASS,
      line: `${plural(counts[PASS], "check", "checks")} passed. ${plural(counts[SKIPPED], "did", "did")} not apply here.`,
    };
  return {
    status: PASS,
    line: `All ${total} checks passed. That is the service reporting on its own checks — your wallet still verifies the transaction itself before you sign.`,
  };
}

/**
 * The verdicts that must stop an action, which is everything that is not a
 * plain pass.
 *
 * Including `unverifiable` here is a deliberate, costly choice. The eligibility
 * check falls back to the registry entry whenever the chain is unreachable, so
 * this rule means a flaky RPC makes the wallet refuse to prepare anything until
 * it recovers. That is the price of the fourth state meaning something: a state
 * that says "this was never established" and then lets the action through is a
 * label, not a check.
 *
 * `skipped` blocks for the older reason — a gate absent from the response is
 * not a gate that passed.
 */
export function blockers(verdicts = []) {
  return verdicts.filter((entry) => entry?.status !== PASS);
}

/** Why an action was stopped, naming the checks rather than the count. */
export function blockingReason(verdicts = [], { labels = {} } = {}) {
  const stopped = blockers(verdicts);
  if (!stopped.length) return "";
  const name = (entry) => labels[entry.gate] || entry.gate;
  const failed = stopped.filter((entry) => entry.status === FAIL);
  const unproven = stopped.filter((entry) => entry.status === UNVERIFIABLE);
  const missing = stopped.filter((entry) => entry.status === SKIPPED);
  const parts = [];
  if (failed.length) parts.push(`${failed.map(name).join(", ")} blocked it`);
  if (unproven.length) parts.push(`${unproven.map(name).join(", ")} could not be established`);
  if (missing.length) parts.push(`${missing.map(name).join(", ")} did not run`);
  return `${parts.join("; ")}. Nothing was prepared.`;
}

/** True when a set is safe to act on without an owner reading further. */
export function clean(verdicts = []) {
  const counts = tally(verdicts);
  return counts[FAIL] === 0 && counts[UNVERIFIABLE] === 0;
}
