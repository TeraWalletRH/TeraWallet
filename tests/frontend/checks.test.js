import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GATE_LABELS,
  GATE_EXPLANATIONS,
  gateNuance,
  explainGate,
  localChecks,
  localSummary,
} from "../../public/tera/wallet/checks.js";
import { GATES, ZERO_ADDRESS } from "../../public/tera/wallet/core.js";

const chainId = 4663;
const owner = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const token = `0x${"3".repeat(40)}`;
const hash = `0x${"4".repeat(64)}`;
const amount = "1234567";

function transfer(overrides = {}) {
  const intent = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: token,
    recipient,
    actionType: "TRANSFER",
    amount,
    ...overrides.intent,
  };
  return {
    intent,
    gates: GATES.map((gate) => ({ gate, passed: true })),
    preparedTransaction: {
      to: token,
      data: `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`,
      value: "0x0",
      chainId,
      actionHash: hash,
      intent,
      ...overrides.preparedTransaction,
    },
    ...overrides.proposal,
  };
}

const idsOf = (rows) => rows.filter((row) => !row.passed).map((row) => row.id);

test("every check has a rule, an evaluator and a withheld list", () => {
  for (const gate of GATES) {
    const explanation = GATE_EXPLANATIONS[gate];
    assert.ok(explanation, `missing explanation for ${gate}`);
    assert.ok(explanation.rule.length > 10);
    assert.ok(explanation.meaning.length > 10);
    assert.ok(explanation.inputs.length > 0);
    assert.ok(explanation.withheld.length > 0);
    assert.ok(GATE_LABELS[gate]);
  }
  // The owner-approval check is the one enforced on the owner's side.
  assert.equal(GATE_EXPLANATIONS.approval_controller.evaluatedBy, "Your wallet");
});

test("explainGate reports the result and keeps the service reason", () => {
  const passed = explainGate("policy_vault", { gate: "policy_vault", passed: true });
  assert.equal(passed.result, "PASS");
  assert.equal(passed.label, "Policy check");
  const blocked = explainGate("policy_vault", {
    gate: "policy_vault",
    passed: false,
    reason: "Over the limit.",
  });
  assert.equal(blocked.result, "BLOCKED");
  assert.equal(blocked.reason, "Over the limit.");
  assert.equal(explainGate("risk_engine", undefined).result, "NOT RUN");
});

test("a pass reached by registry fallback is not presented as an on-chain check", () => {
  const nuance = gateNuance({
    passed: true,
    details: { rpcFallback: true, canTransfer: "unknown", verifiedInRegistry: true },
  });
  assert.match(nuance, /registry entry alone/);
  assert.match(nuance, /unverified/);
  assert.match(gateNuance({ passed: true, details: { verifiedOnChain: true } }), /on-chain/);
  assert.equal(gateNuance({ passed: true }), "");
  assert.equal(gateNuance(undefined), "");
});

test("a faithful transfer matches on every local comparison", () => {
  const rows = localChecks(transfer(), owner, chainId);
  assert.ok(rows.length >= 7);
  assert.deepEqual(idsOf(rows), []);
  assert.equal(localSummary(rows).passed, true);
  assert.match(localSummary(rows).text, /All \d+ comparisons match/);
});

test("calldata pointing at another recipient is caught even when every gate passes", () => {
  const attacker = `0x${"9".repeat(40)}`;
  const proposal = transfer({
    preparedTransaction: {
      data: `0xa9059cbb${attacker.slice(2).padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`,
    },
  });
  assert.ok(proposal.gates.every((gate) => gate.passed));
  const rows = localChecks(proposal, owner, chainId);
  assert.deepEqual(idsOf(rows), ["recipient"]);
  assert.equal(localSummary(rows).passed, false);
  assert.match(localSummary(rows).text, /Do not approve/);
});

test("calldata carrying a larger amount is caught locally", () => {
  const proposal = transfer({
    preparedTransaction: {
      data: `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${999999999n.toString(16).padStart(64, "0")}`,
    },
  });
  assert.deepEqual(idsOf(localChecks(proposal, owner, chainId)), ["amount"]);
});

test("a transaction aimed at the wrong contract is caught", () => {
  const proposal = transfer({ preparedTransaction: { to: `0x${"8".repeat(40)}` } });
  assert.deepEqual(idsOf(localChecks(proposal, owner, chainId)), ["target"]);
});

test("a proposal for a different wallet or network is caught", () => {
  assert.deepEqual(idsOf(localChecks(transfer(), `0x${"7".repeat(40)}`, chainId)), ["owner"]);
  assert.deepEqual(idsOf(localChecks(transfer(), owner, 1)), ["network"]);
});

test("a token transfer that also moves native value is caught", () => {
  const proposal = transfer({ preparedTransaction: { value: "0x64" } });
  assert.deepEqual(idsOf(localChecks(proposal, owner, chainId)), ["amount"]);
});

test("a missing or failed gate is reported by the local check too", () => {
  const proposal = transfer();
  proposal.gates = proposal.gates.filter((gate) => gate.gate !== "risk_engine");
  assert.deepEqual(idsOf(localChecks(proposal, owner, chainId)), ["checks"]);
});

test("native transfers are verified against value and an empty payload", () => {
  const intent = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: ZERO_ADDRESS,
    recipient,
    actionType: "TRANSFER",
    amount: "1000",
  };
  const good = {
    intent,
    gates: GATES.map((gate) => ({ gate, passed: true })),
    preparedTransaction: {
      to: recipient,
      data: "0x",
      value: "1000",
      chainId,
      actionHash: hash,
      intent,
    },
  };
  assert.deepEqual(idsOf(localChecks(good, owner, chainId)), []);
  const tampered = {
    ...good,
    preparedTransaction: { ...good.preparedTransaction, value: "5000" },
  };
  assert.deepEqual(idsOf(localChecks(tampered, owner, chainId)), ["amount"]);
});

test("expiry is only compared when the service supplied one", () => {
  const withoutExpiry = localChecks(transfer(), owner, chainId);
  assert.equal(
    withoutExpiry.some((row) => row.id === "expiry"),
    false,
  );
  const expired = transfer({ proposal: { expiresAt: 1000 } });
  assert.deepEqual(idsOf(localChecks(expired, owner, chainId, 2000)), ["expiry"]);
  assert.deepEqual(idsOf(localChecks(expired, owner, chainId, 500)), []);
});

test("a proposal with no prepared transaction yields nothing to verify", () => {
  assert.deepEqual(localChecks({ intent: {} }, owner, chainId), []);
  assert.deepEqual(localChecks(undefined, owner, chainId), []);
  assert.equal(localSummary([]).passed, false);
});

test("a pass the service could not establish is not reported as a pass", () => {
  // The service sets passed:true and, in the same object, that the check it
  // needed was unavailable. Before this, explainGate read the boolean and put
  // the caveat in a separate field that the row rendered in smaller type.
  const hollow = explainGate("eligibility_preflight", {
    gate: "eligibility_preflight",
    passed: true,
    details: { rpcFallback: true },
  });
  assert.equal(hollow.result, "UNPROVEN");
  assert.equal(hollow.status, "unverifiable");
  assert.equal(hollow.hollow, "rpcFallback");
  assert.match(hollow.nuance, /unverified/i);

  // An ordinary pass is untouched.
  const plain = explainGate("eligibility_preflight", {
    gate: "eligibility_preflight",
    passed: true,
    details: { verifiedOnChain: true },
  });
  assert.equal(plain.result, "PASS");
  assert.equal(plain.hollow, "");
});
