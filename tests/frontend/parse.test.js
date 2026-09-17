import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER,
  NAVIGATE,
  COMPOSE,
  NONE,
  TOPICS,
  DESTINATIONS,
  parse,
  respond,
} from "../../public/tera/wallet/parse.js";
import { GATE_LABELS, GATE_EXPLANATIONS } from "../../public/tera/wallet/checks.js";
import { STAGES, SIDE_NOTES, OWNER } from "../../public/tera/wallet/boundary.js";
import { KIND_LABELS, PROPOSE_KEEP } from "../../public/tera/wallet/minimise.js";
import { LIMITS as OHTTP_LIMITS } from "../../public/tera/wallet/ohttp.js";
import { LIMITS as ENGINE_LIMITS } from "../../public/tera/wallet/engine.js";
import { LIMITS as WIPE_LIMITS } from "../../public/tera/wallet/wipe.js";
import { LOCAL_ONLY } from "../../public/tera/wallet/privacy.js";
import { MODELS, SUBMISSION_LIMITS, WHY_FIXED } from "../../public/tera/wallet/submission.js";
import { READ_METHODS } from "../../public/tera/wallet/endpoint.js";
import { GATES } from "../../public/tera/wallet/core.js";

// Exactly what app.js passes, so the tests exercise the real wiring.
const sources = {
  gates: GATES,
  gateLabels: GATE_LABELS,
  gateExplanations: GATE_EXPLANATIONS,
  stages: STAGES,
  sideNotes: SIDE_NOTES,
  owner: OWNER,
  kindLabels: KIND_LABELS,
  proposeKeep: PROPOSE_KEEP,
  ohttpLimits: OHTTP_LIMITS,
  engineLimits: ENGINE_LIMITS,
  wipeLimits: WIPE_LIMITS,
  localOnly: LOCAL_ONLY,
  submissionModel: MODELS.sequenced,
  submissionLimits: SUBMISSION_LIMITS,
  whyFixed: WHY_FIXED,
  readMethods: READ_METHODS,
};

const answerTo = (message) => respond(parse(message), sources);

test("a question about the owner's own money is refused before any topic matches", () => {
  // "policy" and "balance" share vocabulary with several topics. Getting this
  // wrong would mean a confident answer about holdings this device cannot see.
  for (const message of [
    "what is my balance?",
    "how much USDG do I have",
    "show me my holdings",
    "what is my policy balance",
  ]) {
    const result = parse(message);
    assert.equal(result.matched, false, message);
    assert.equal(result.kind, NONE, message);
  }
  assert.match(parse("what is my balance?").reason, /own holdings/i);
});

test("the five checks are answered from checks.js, not from a copy", () => {
  const result = answerTo("what are the five checks?");
  assert.equal(result.module, "checks.js");
  // Every rule must appear verbatim: that is what makes this better than a model.
  for (const gate of GATES) {
    assert.ok(result.body.includes(GATE_EXPLANATIONS[gate].rule), `${gate} rule must be quoted`);
    assert.ok(result.body.includes(GATE_LABELS[gate]), `${gate} label must appear`);
  }
});

test("a question about one check answers about that check only", () => {
  const result = answerTo("what does the policy check do?");
  assert.equal(result.title, GATE_LABELS.policy_vault);
  assert.ok(result.body.includes(GATE_EXPLANATIONS.policy_vault.rule));
  assert.ok(
    result.body.includes(GATE_EXPLANATIONS.policy_vault.meaning),
    "the caveat must survive",
  );
  assert.ok(
    !result.body.includes(GATE_EXPLANATIONS.risk_engine.rule),
    "it must not spill into the other checks",
  );
});

test("what a pass does not mean is never dropped from a gate answer", () => {
  // The `meaning` field exists because a bare PASS overstates the result. An
  // answer that quoted the rule and omitted this would be worse than silence.
  for (const [gate, detail] of Object.entries(GATE_EXPLANATIONS)) {
    const label = GATE_LABELS[gate].toLowerCase();
    const result = answerTo(`what does the ${label} check?`);
    if (!result) continue;
    assert.ok(result.body.includes(detail.meaning), gate);
  }
});

test("a check-shaped question that names no check falls through to the summary", () => {
  const result = answerTo("how is this checked?");
  assert.equal(result.title, "The five checks");
});

test("each topic quotes the module it cites", () => {
  const cases = [
    ["what is prompt minimisation?", "minimise.js", Object.values(KIND_LABELS)],
    ["how does oblivious http work?", "ohttp.js", OHTTP_LIMITS],
    ["tell me about the on-device model", "engine.js", ENGINE_LIMITS],
    ["what does a wipe not cover?", "wipe.js", WIPE_LIMITS],
    ["who sees my transaction?", "submission.js", SUBMISSION_LIMITS],
    ["what never leaves my device?", "privacy.js", LOCAL_ONLY.map((item) => item.detail)],
    ["how are balances read?", "endpoint.js", READ_METHODS],
  ];
  for (const [message, module, quoted] of cases) {
    const result = answerTo(message);
    assert.ok(result, message);
    assert.equal(result.module, module, message);
    for (const line of quoted) assert.ok(result.body.includes(line), `${message} → ${line}`);
  }
});

test("the sequencer correction survives into the submission answer", () => {
  // The single most important sentence in submission.js: "no public mempool"
  // is not privacy. An answer that dropped it would restore the comfortable
  // misreading the module exists to correct.
  const result = answerTo("is there a mempool on this chain?");
  assert.ok(result.body.includes(MODELS.sequenced.correction));
  assert.ok(result.body.includes(WHY_FIXED));
});

test("the boundary answer marks the owner's side", () => {
  const result = answerTo("what is the owner approval boundary?");
  assert.equal(result.module, "boundary.js");
  assert.ok(result.body.includes(SIDE_NOTES[OWNER].note));
  for (const stage of STAGES) assert.ok(result.body.includes(stage.label), stage.id);
});

test("recovery is explained with the part that is uncomfortable", () => {
  const result = answerTo("how do recovery shares work?");
  assert.match(result.body, /open the vault without you/i);
  assert.match(result.body, /does not recover the wallet itself|Neither recovers the wallet/i);
});

test("a transfer request is carried to the composer, never executed", () => {
  const result = parse("send 50 USDG to 0x8ba1f109551bd432803012645ac136ddd64dba72");
  assert.equal(result.kind, COMPOSE);
  assert.deepEqual(result.slots, {
    amount: "50",
    symbol: "USDG",
    recipient: "0x8ba1f109551bd432803012645ac136ddd64dba72",
  });
  // Nothing about a compose result may look like an answer or a transaction.
  assert.equal(respond(result, sources), null);
});

test("a transfer with a grouped amount and no symbol still parses", () => {
  const result = parse("pay 1,250 to 0x8ba1f109551bd432803012645ac136ddd64dba72");
  assert.equal(result.slots.amount, "1250");
  assert.equal(result.slots.symbol, "");
});

test("a transfer without a full address is not a compose", () => {
  // Half an address is the shape of a mistake, not an instruction.
  assert.equal(parse("send 50 USDG to alice").matched, false);
  assert.equal(parse("send 50 USDG to 0x8ba1f1").matched, false);
});

test("navigation is recognised only with a destination", () => {
  assert.deepEqual(
    { kind: parse("open approvals").kind, page: parse("open approvals").page },
    { kind: NAVIGATE, page: "approvals" },
  );
  assert.equal(parse("show me my receipts please").page, "receipts");
  assert.equal(parse("where is the bridge").page, "bridge");
  // "open" alone names nowhere to go.
  assert.equal(parse("open").matched, false);
  assert.equal(parse("take me somewhere").matched, false);
});

test("an unmatched message reports no match rather than a nearest guess", () => {
  for (const message of [
    "what do you think about the market",
    "explain quantum computing",
    "hello",
    "",
    "   ",
  ]) {
    const result = parse(message);
    assert.equal(result.matched, false, message);
    assert.equal(respond(result, sources), null, message);
  }
});

test("every answer says it came from the code rather than from a model", () => {
  for (const topic of TOPICS) {
    const slots = topic.id === "gate" ? { gate: "policy_vault" } : {};
    const result = respond({ kind: ANSWER, topic: topic.id, slots }, sources);
    assert.ok(result, topic.id);
    assert.ok(result.note.includes(topic.module), topic.id);
    assert.match(result.note, /no request was made/i, topic.id);
    assert.ok(result.title.length > 0, topic.id);
    assert.ok(result.body.length > 0, topic.id);
  }
});

test("every topic and destination is reachable from a plausible question", () => {
  // A pattern nobody can trigger is dead weight that still has to be maintained.
  const reached = new Set();
  const questions = [
    "what are the five checks?",
    "what does the risk check do?",
    "what is the approval boundary?",
    "what is prompt minimisation?",
    "what is ohttp?",
    "does the model run in my browser?",
    "is there a mempool?",
    "what is the encrypted vault?",
    "what is shamir used for?",
    "how do I wipe this browser?",
    "can I use my own rpc?",
    "what does tera see?",
  ];
  for (const question of questions) {
    const result = parse(question);
    if (result.kind === ANSWER) reached.add(result.topic);
  }
  for (const topic of TOPICS) assert.ok(reached.has(topic.id), `unreachable topic: ${topic.id}`);

  for (const destination of DESTINATIONS) {
    const result = parse(`open ${destination.page}`);
    assert.equal(result.kind, NAVIGATE, destination.page);
  }
});
