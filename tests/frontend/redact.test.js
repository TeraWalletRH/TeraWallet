import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redactProposal,
  redactText,
  amountBand,
  toText,
  leaks,
  GATE_LABELS,
  WITHHELD,
} from "../../public/tera/wallet/redact.js";
import { GATES } from "../../public/tera/wallet/core.js";
import { demoProposal, DEMO_ASSETS, DEMO_OWNER } from "../../public/tera/wallet/demo.js";

const chainId = 4663;
const owner = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const token = `0x${"3".repeat(40)}`;
const hash = `0x${"4".repeat(64)}`;
const asset = { symbol: "USDG", name: "Settlement dollar", decimals: 6, category: "stablecoin" };

function proposal(overrides = {}) {
  const intent = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: token,
    recipient,
    actionType: "TRANSFER",
    amount: "2500000000",
    ...overrides.intent,
  };
  return {
    intent,
    explanation: "Prepared a transfer of 2,500 USDG to 0x2222222222222222222222222222222222222222.",
    gates: GATES.map((gate) => ({ gate, passed: true, reason: "Checked." })),
    preparedTransaction: {
      to: token,
      data: `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${(2500000000).toString(16).padStart(64, "0")}`,
      value: "0x0",
      chainId,
      actionHash: hash,
      intent,
    },
    ...overrides,
  };
}

test("the shared document carries no address, calldata or exact amount", () => {
  const source = proposal();
  const document = redactProposal(source, asset, { chainId });
  const serialized = JSON.stringify(document);
  for (const secret of [owner, recipient, token, hash, source.preparedTransaction.data])
    assert.equal(serialized.includes(secret), false, `leaked ${secret.slice(0, 12)}`);
  assert.equal(serialized.includes("2500000000"), false, "leaked the exact amount");
  assert.deepEqual(leaks(document, source.intent), []);
});

test("calldata is never carried over, because it encodes recipient and amount", () => {
  const document = redactProposal(proposal(), asset, { chainId });
  assert.equal(JSON.stringify(document).includes("a9059cbb"), false);
  assert.equal(document.action.contract, WITHHELD);
  assert.ok(document.withheld.includes("Prepared transaction calldata"));
});

test("the checks and the decision survive redaction intact", () => {
  const document = redactProposal(proposal(), asset, { chainId });
  assert.equal(document.checks.length, GATES.length);
  assert.deepEqual(
    document.checks.map((row) => row.check),
    GATES.map((gate) => GATE_LABELS[gate]),
  );
  assert.ok(document.checks.every((row) => row.result === "PASS"));
  assert.equal(document.decision, "Awaiting the owner signature");
  assert.equal(document.network.chainId, chainId);
  assert.equal(document.action.type, "TRANSFER");
  assert.equal(document.action.asset.symbol, "USDG");
});

test("a blocked proposal names the check that stopped it", () => {
  const gates = GATES.map((gate) => ({
    gate,
    passed: gate !== "policy_vault",
    reason: gate === "policy_vault" ? "Above the per-action limit of 1,000 USDG." : "Checked.",
  }));
  const document = redactProposal(proposal({ gates }), asset, { chainId });
  assert.equal(document.decision, "Blocked at: Policy check");
  const policy = document.checks.find((row) => row.check === "Policy check");
  assert.equal(policy.result, "BLOCKED");
  // The rule is named; the limit behind it is not.
  assert.match(policy.reason, /Above the per-action limit of \[amount withheld\]/);
});

test("a submitted proposal reports approval without the transaction hash", () => {
  const document = redactProposal(proposal({ txHash: hash }), asset, { chainId });
  assert.equal(document.decision, "Approved by the owner and submitted");
  assert.equal(JSON.stringify(document).includes(hash), false);
});

test("amounts become order-of-magnitude bands", () => {
  assert.equal(amountBand("999999", 6), "Less than 1");
  assert.equal(amountBand("1000000", 6), "1 to 10");
  assert.equal(amountBand("9999999", 6), "1 to 10");
  assert.equal(amountBand("10000000", 6), "10 to 100");
  assert.equal(amountBand("2500000000", 6), "1,000 to 10,000");
  assert.equal(amountBand("5000000000000", 6), "1,000,000 or more");
  assert.equal(amountBand("not-a-number", 6), "Amount withheld");
});

test("free text is scrubbed of addresses, references and figures", () => {
  const scrubbed = redactText(
    `Sent 2,500 USDG to ${recipient} under reference ${hash} with calldata 0xa9059cbb0000.`,
  );
  assert.equal(scrubbed.includes(recipient), false);
  assert.equal(scrubbed.includes(hash), false);
  assert.equal(scrubbed.includes("2,500"), false);
  assert.match(scrubbed, /\[address withheld\]/);
  assert.match(scrubbed, /\[reference withheld\]/);
  assert.match(scrubbed, /\[data withheld\]/);
});

test("scrubbing keeps small counts and standard names readable", () => {
  assert.equal(
    redactText("All 5 checks passed under ERC-3643."),
    "All 5 checks passed under ERC-3643.",
  );
  assert.equal(redactText("Slippage 0.5% applied."), "Slippage [amount withheld]% applied.");
  assert.equal(redactText(""), "");
});

test("the action reference is opt-in and truncated when included", () => {
  const withoutReference = redactProposal(proposal(), asset, { chainId });
  assert.equal(withoutReference.action.reference, undefined);
  assert.ok(withoutReference.withheld.includes("Action reference"));
  const withReference = redactProposal(proposal(), asset, { chainId, includeReference: true });
  assert.ok(withReference.action.reference.startsWith("0x4444"));
  assert.ok(withReference.action.reference.length < 20);
  assert.equal(JSON.stringify(withReference).includes(hash), false);
  assert.equal(withReference.withheld.includes("Action reference"), false);
});

test("an unknown asset withholds the amount rather than guessing", () => {
  const document = redactProposal(proposal(), null, { chainId });
  assert.equal(document.action.amountBand, "Amount withheld");
  assert.equal(document.action.asset, null);
});

test("the text rendering carries the same redactions as the document", () => {
  const source = proposal();
  const text = toText(redactProposal(source, asset, { chainId }));
  for (const secret of [owner, recipient, token, hash, "2500000000"])
    assert.equal(text.includes(secret), false, `leaked ${secret.slice(0, 12)}`);
  assert.match(text, /Amount: 1,000 to 10,000 USDG/);
  assert.match(text, /Owner: \[withheld\]/);
  assert.match(text, /PASS {5}Asset registry/);
  assert.match(text, /Decision: Awaiting the owner signature/);
});

test("leaks() catches a document that still holds owner data", () => {
  const source = proposal();
  const document = redactProposal(source, asset, { chainId });
  document.action.owner = owner;
  assert.deepEqual(leaks(document, source.intent), ["address"]);
});

test("demo proposals redact cleanly too", () => {
  const source = demoProposal(chainId);
  const usdg = DEMO_ASSETS.find((entry) => entry.symbol === "USDG");
  const document = redactProposal(source, usdg, { chainId });
  assert.deepEqual(leaks(document, source.intent), []);
  assert.equal(JSON.stringify(document).includes(DEMO_OWNER), false);
  assert.equal(document.action.amountBand, "100 to 1,000 USDG");
});

// A check the service reported as passing but could not establish. Before the
// vocabulary reached this module it printed as a flat PASS in the one artefact
// that leaves the building.
const hollowGates = GATES.map((gate) =>
  gate === "eligibility_preflight"
    ? { gate, passed: true, reason: "Checked.", details: { rpcFallback: true } }
    : { gate, passed: true, reason: "Checked." },
);

test("an unproven check is not printed as a pass in the shared document", () => {
  const document = redactProposal(proposal({ gates: hollowGates }), asset, { chainId });
  const eligibility = document.checks.find(
    (row) => row.check === GATE_LABELS.eligibility_preflight,
  );
  assert.equal(eligibility.result, "UNPROVEN");
  assert.match(eligibility.reason, /unverified/i);
  // The other four are untouched.
  assert.equal(document.checks.filter((row) => row.result === "PASS").length, GATES.length - 1);
});

test("the document's decision does not round an unproven check up to ready", () => {
  const document = redactProposal(proposal({ gates: hollowGates }), asset, { chainId });
  assert.match(document.decision, /^Not ready:/);
  assert.match(document.decision, /could not be established/i);
  assert.notEqual(document.decision, "Awaiting the owner signature");
});

test("the document's note describes the four states it actually uses", () => {
  // It used to promise "the checks and their results are unchanged" while
  // flattening a state the wallet distinguished.
  const document = redactProposal(proposal({ gates: hollowGates }), asset, { chainId });
  for (const state of ["PASS", "BLOCKED", "UNPROVEN", "NOT RUN"])
    assert.ok(document.note.includes(state), `the note does not mention ${state}`);
  assert.match(document.note, /not a weaker pass/i);
});

test("the plain-text rendering shows the unproven state and its reason", () => {
  const text = toText(redactProposal(proposal({ gates: hollowGates }), asset, { chainId }));
  assert.match(text, /UNPROVEN {1}Eligibility|UNPROVEN\s+Eligibility/);
  assert.match(text, /Decision: Not ready:/);
});

test("redacting an unproven document still leaks nothing", () => {
  // The new detail text is service wording, so it goes through the same
  // redaction as every other reason rather than around it.
  const p = proposal({ gates: hollowGates });
  const document = redactProposal(p, asset, { chainId });
  assert.deepEqual(leaks(document, p.intent), []);
});
