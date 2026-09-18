import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PASS,
  FAIL,
  UNVERIFIABLE,
  SKIPPED,
  ORDER,
  LABELS,
  HOLLOW,
  labelFor,
  gateVerdict,
  gateVerdicts,
  tally,
  worst,
  summarise,
  clean,
  blockers,
  blockingReason,
} from "../../public/tera/core/verdict.js";
import { GATES } from "../../public/tera/wallet/core.js";

const gate = (name, passed, details) => ({ gate: name, passed, details });
const allPassing = GATES.map((name) => gate(name, true));

test("a pass that was never established is not a pass", () => {
  // The whole build. The service reports passed:true and, in the same object,
  // that the check it would have needed was unavailable.
  const verdict = gateVerdict(gate("eligibility_preflight", true, { rpcFallback: true }));
  assert.equal(verdict.status, UNVERIFIABLE);
  assert.equal(verdict.hollow, "rpcFallback");
  assert.match(verdict.detail, /unverified/i);
  assert.notEqual(verdict.status, PASS);
});

test("every way of passing without checking is caught", () => {
  for (const [details, id] of [
    [{ rpcFallback: true }, "rpcFallback"],
    [{ canTransfer: "unknown" }, "canTransferUnknown"],
    [{ quoteAge: "unknown" }, "staleQuote"],
    [{ staticDefaults: true }, "staleQuote"],
  ]) {
    const verdict = gateVerdict(gate("risk_engine", true, details));
    assert.equal(verdict.status, UNVERIFIABLE, JSON.stringify(details));
    assert.equal(verdict.hollow, id, JSON.stringify(details));
  }
  assert.equal(HOLLOW.length, 3, "a new way to pass without checking must be added to HOLLOW");
});

test("an ordinary pass stays a pass", () => {
  assert.equal(gateVerdict(gate("asset_registry", true)).status, PASS);
  assert.equal(gateVerdict(gate("asset_registry", true, { verifiedOnChain: true })).status, PASS);
});

test("a blocked gate carries the reason it gave", () => {
  const verdict = gateVerdict({ gate: "policy_vault", passed: false, reason: "Over the limit." });
  assert.equal(verdict.status, FAIL);
  assert.equal(verdict.detail, "Over the limit.");
});

test("a gate missing from the response is not a gate that passed", () => {
  // The dangerous default. An absent check must read as absent.
  assert.equal(gateVerdict(undefined).status, SKIPPED);
  assert.equal(gateVerdict(null).status, SKIPPED);
  const rows = gateVerdicts([gate("asset_registry", true)], GATES);
  assert.equal(rows.length, GATES.length, "every named gate gets a row");
  assert.equal(rows[0].status, PASS);
  for (const row of rows.slice(1)) assert.equal(row.status, SKIPPED, row.gate);
});

test("one blocked check makes the whole set blocked, however many passed", () => {
  const rows = gateVerdicts([...allPassing.slice(0, 4), gate("approval_controller", false)], GATES);
  assert.equal(worst(rows), FAIL);
  assert.equal(clean(rows), false);
  assert.match(summarise(rows).line, /blocked this action/i);
});

test("one unproven check is named in the summary, never averaged away", () => {
  // This is the sentence that replaces "Five service checks passed".
  const rows = gateVerdicts(
    [
      gate("asset_registry", true),
      gate("eligibility_preflight", true, { rpcFallback: true }),
      gate("policy_vault", true),
      gate("risk_engine", true),
      gate("approval_controller", true),
    ],
    GATES,
  );
  const result = summarise(rows);
  assert.equal(result.status, UNVERIFIABLE);
  assert.match(result.line, /could not be established/i);
  assert.ok(!/^All /.test(result.line), "it must not open by claiming everything passed");
  assert.equal(clean(rows), false, "an unproven set is not safe to act on unread");
});

test("the all-passed sentence still refuses to overclaim", () => {
  const result = summarise(gateVerdicts(allPassing, GATES));
  assert.equal(result.status, PASS);
  assert.match(result.line, /All 5 checks passed/);
  // A pass is the service reporting on itself. The old mobile copy said
  // "transaction verified locally" in the same breath, which conflated the two.
  assert.match(result.line, /service reporting on its own checks/i);
  assert.match(result.line, /your wallet still verifies/i);
  assert.equal(clean(gateVerdicts(allPassing, GATES)), true);
});

test("nothing run reads as nothing run", () => {
  assert.equal(summarise([]).line, "No checks ran.");
  assert.equal(summarise(gateVerdicts([], GATES)).line, "No check has run yet.");
});

test("worst-first ordering is the order a summary reports in", () => {
  assert.deepEqual(ORDER, [FAIL, UNVERIFIABLE, PASS, SKIPPED]);
  // A set with both a block and an unproven reports the block.
  const rows = gateVerdicts(
    [
      gate("asset_registry", true, { rpcFallback: true }),
      gate("policy_vault", false, { reason: "no" }),
    ],
    GATES,
  );
  assert.equal(worst(rows), FAIL);
});

test("counts add up to the number of checks", () => {
  const rows = gateVerdicts(
    [...allPassing.slice(0, 3), gate("risk_engine", true, { staticDefaults: true })],
    GATES,
  );
  const counts = tally(rows);
  assert.equal(counts[PASS] + counts[FAIL] + counts[UNVERIFIABLE] + counts[SKIPPED], GATES.length);
  assert.equal(counts[UNVERIFIABLE], 1);
  assert.equal(counts[SKIPPED], 1);
});

test("a gate that said no is blocked, a hash that did not match failed", () => {
  // Same four states, different honest word per context.
  assert.equal(labelFor(FAIL, "gate"), "Blocked");
  assert.equal(labelFor(FAIL, "receipt"), "Failed");
  assert.equal(labelFor(UNVERIFIABLE, "gate"), "Unproven");
  assert.equal(labelFor(UNVERIFIABLE, "receipt"), "Unproven");
  assert.equal(labelFor(SKIPPED, "gate"), "Not run");
  // Every state has a word in every context.
  for (const context of Object.keys(LABELS))
    for (const status of ORDER)
      assert.ok(LABELS[context][status], `${context} has no word for ${status}`);
});

test("unproven is never worded as a warning", () => {
  // A warning is advice about something known. This is the absence of
  // knowledge, and the two lead an owner to different decisions.
  const wording = [
    LABELS.gate[UNVERIFIABLE],
    LABELS.receipt[UNVERIFIABLE],
    ...HOLLOW.map((entry) => entry.detail),
  ].join(" ");
  assert.ok(!/\bwarning\b|\bcaution\b|\blikely\b|\bprobably\b/i.test(wording), wording);
});

test("a duplicate row cannot hide a weaker result behind a clean one", () => {
  // Malformed input, and therefore exactly where care is worth taking: a second
  // row for the same gate must not be masked by whichever was listed first.
  const rows = gateVerdicts(
    [
      gate("asset_registry", true),
      gate("asset_registry", true, { rpcFallback: true }),
      ...allPassing.slice(1),
    ],
    GATES,
  );
  assert.equal(rows[0].status, UNVERIFIABLE, "the worse of the two must win");

  const reversed = gateVerdicts(
    [
      gate("asset_registry", true, { rpcFallback: true }),
      gate("asset_registry", true),
      ...allPassing.slice(1),
    ],
    GATES,
  );
  assert.equal(reversed.status, undefined);
  assert.equal(reversed[0].status, UNVERIFIABLE, "order must not change the outcome");
});

test("an unproven check stops the action, at a cost that is written down", () => {
  // The fourth state has to mean something. A state that says "this was never
  // established" and then lets the action through is a label, not a check.
  const rows = gateVerdicts(
    [
      gate("asset_registry", true),
      gate("eligibility_preflight", true, { rpcFallback: true }),
      gate("policy_vault", true),
      gate("risk_engine", true),
      gate("approval_controller", true),
    ],
    GATES,
  );
  const stopped = blockers(rows);
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].gate, "eligibility_preflight");
  assert.match(blockingReason(rows), /could not be established/i);
  assert.match(blockingReason(rows), /Nothing was prepared/);
});

test("only a clean sweep of passes lets an action through", () => {
  assert.deepEqual(blockers(gateVerdicts(allPassing, GATES)), []);
  assert.equal(blockingReason(gateVerdicts(allPassing, GATES)), "");

  // A gate absent from the response blocks for the older reason: it is not a
  // gate that passed.
  const partial = gateVerdicts([gate("asset_registry", true)], GATES);
  assert.equal(blockers(partial).length, GATES.length - 1);
  assert.match(blockingReason(partial), /did not run/i);
});

test("the reason names the checks rather than counting them", () => {
  const rows = gateVerdicts(
    [
      gate("asset_registry", true),
      gate("eligibility_preflight", true, { rpcFallback: true }),
      gate("policy_vault", false),
      gate("risk_engine", true),
      gate("approval_controller", true),
    ],
    GATES,
  );
  const reason = blockingReason(rows, { labels: { policy_vault: "Policy check" } });
  assert.match(reason, /Policy check blocked it/);
  assert.match(reason, /eligibility_preflight could not be established/);
  // Blocked is reported before unproven, the same worst-first order as everywhere.
  assert.ok(reason.indexOf("blocked it") < reason.indexOf("could not be established"));
});
