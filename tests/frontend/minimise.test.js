import { test } from "node:test";
import assert from "node:assert/strict";
import {
  minimise,
  rehydrate,
  residual,
  summary,
  keptKinds,
  PROPOSE_KEEP,
  KIND_LABELS,
} from "../../public/tera/core/minimise.js";
import * as exported from "../../public/tera/core/minimise.js";

const owner = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const other = `0x${"3".repeat(40)}`;
const hash = `0x${"4".repeat(64)}`;

test("the skeleton carries no address, reference or figure", () => {
  const result = minimise(
    `Send 2,500 USDG from ${owner} to ${recipient}, same as ${hash}. Ping payroll@acme.co or acme.eth.`,
    { owner },
  );
  assert.equal(result.skeleton.includes(owner), false);
  assert.equal(result.skeleton.includes(recipient), false);
  assert.equal(result.skeleton.includes(hash), false);
  assert.equal(result.skeleton.includes("2,500"), false);
  assert.equal(result.skeleton.includes("payroll@acme.co"), false);
  assert.equal(result.skeleton.includes("acme.eth"), false);
  assert.deepEqual(residual(result.skeleton), []);
});

test("the owner's own address reads as itself and keeps the sentence legible", () => {
  const result = minimise(`Move funds from ${owner} to ${recipient}`, { owner });
  assert.equal(result.skeleton, "Move funds from [YOUR_ADDRESS] to [ADDRESS_1]");
});

test("a value mentioned twice keeps one placeholder", () => {
  const result = minimise(`Pay ${recipient}. Confirm ${recipient} is on the allow list.`);
  assert.equal(result.placeholders.length, 1);
  assert.equal(result.skeleton, "Pay [ADDRESS_1]. Confirm [ADDRESS_1] is on the allow list.");
});

test("the reply is re-hydrated with the owner's own values", () => {
  const result = minimise(`Send 4,000 USDG to ${recipient}`);
  const reply = `I prepared a transfer of [AMOUNT_1] USDG to [ADDRESS_1].`;
  const restored = rehydrate(reply, result.placeholders);
  assert.equal(restored, `I prepared a transfer of 4,000 USDG to ${recipient}.`);
});

test("a placeholder echoed in another case is still re-hydrated", () => {
  const result = minimise(`Send to ${recipient}`);
  assert.equal(
    rehydrate("Confirmed for [address_1].", result.placeholders),
    `Confirmed for ${recipient}.`,
  );
});

test("standard references and small counts survive untouched", () => {
  const result = minimise("Does ERC-3643 run all 5 checks before I sign?");
  assert.equal(result.skeleton, "Does ERC-3643 run all 5 checks before I sign?");
  assert.equal(result.placeholders.length, 0);
});

test("figures are removed when they could be an amount", () => {
  assert.equal(minimise("Send $250 now").skeleton, "Send [AMOUNT_1] now");
  assert.equal(minimise("Send 2.5 SPCX").skeleton, "Send [AMOUNT_1] SPCX");
  assert.equal(minimise("Send 250k USDG").skeleton, "Send [AMOUNT_1] USDG");
  assert.equal(minimise("Send 1000 USDG").skeleton, "Send [AMOUNT_1] USDG");
});

test("an already minimised message is not minimised again", () => {
  const once = minimise(`Send 2,500 USDG to ${recipient}`);
  const twice = minimise(once.skeleton);
  assert.equal(twice.skeleton, once.skeleton);
  assert.equal(twice.placeholders.length, 0);
});

test("a proposal keeps the recipient and the figure and reports both", () => {
  const result = minimise(
    `Send 2,500 USDG to ${recipient} and email the receipt to payroll@acme.co, ref ${hash}`,
    { owner, keep: PROPOSE_KEEP },
  );
  assert.equal(result.skeleton.includes(recipient), true);
  assert.equal(result.skeleton.includes("2,500"), true);
  assert.equal(result.skeleton.includes("payroll@acme.co"), false);
  assert.equal(result.skeleton.includes(hash), false);
  assert.deepEqual(keptKinds(result), ["address", "amount"]);
  assert.deepEqual(residual(result.skeleton, PROPOSE_KEEP), []);
});

test("residual reports a kind the skeleton should not still carry", () => {
  assert.deepEqual(residual(`Send to ${other}`), ["address"]);
  assert.deepEqual(residual(`Reference ${hash}`), ["reference"]);
});

test("saved labels are replaced before anything else", () => {
  const result = minimise("Send the monthly run to Payroll Ltd", { labels: ["Payroll Ltd"] });
  assert.equal(result.skeleton, "Send the monthly run to [LABEL_1]");
  assert.equal(result.placeholders[0].kind, "label");
});

test("the segments describe both sides of the same message", () => {
  const result = minimise(`Send to ${recipient}`);
  assert.equal(result.typed.map((segment) => segment.text).join(""), `Send to ${recipient}`);
  assert.equal(result.sent.map((segment) => segment.text).join(""), result.skeleton);
  const marked = result.typed.filter((segment) => segment.kind);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].text, recipient);
});

test("the legend counts what was replaced", () => {
  const result = minimise(`Send 2,500 USDG to ${recipient} and ${other}`);
  assert.deepEqual(summary(result).sort(), ["1 figure", "2 wallet addresses"]);
});

test("every kind that can be replaced has a label", () => {
  const result = minimise(
    `From ${owner} to ${recipient}, ref ${hash}, data 0xa9059cbb0000, 2,500 USDG, payroll@acme.co, acme.eth, +1 302 276 0358, Payroll Ltd`,
    { owner, labels: ["Payroll Ltd"] },
  );
  const kinds = [...new Set(result.placeholders.map((entry) => entry.kind))];
  assert.deepEqual(kinds.sort(), [
    "address",
    "amount",
    "email",
    "label",
    "name",
    "owner",
    "payload",
    "phone",
    "reference",
  ]);
  for (const kind of kinds) assert.equal(typeof KIND_LABELS[kind], "string");
});

test("an empty message produces an empty skeleton and nothing to restore", () => {
  const result = minimise("");
  assert.equal(result.skeleton, "");
  assert.deepEqual(result.placeholders, []);
  assert.equal(rehydrate("", []), "");
});

test("call data is redacted, which the mobile copy used to miss entirely", () => {
  // This is the drift that justified one shared core. The web wallet replaced
  // calldata with [DATA_n]; android/src/minimise.ts had no payload rule, so the
  // same message left a phone in full and a browser redacted, while both
  // surfaces told the owner the same thing about what had been removed.
  const calldata =
    "0xa9059cbb0000000000000000000000008ba1f109551bd432803012645ac136ddd64dba720000000000000000000000000000000000000000000000000000000000000001";
  const result = minimise(`call ${calldata} on it`, { owner: "" });
  assert.deepEqual(
    result.placeholders.map((entry) => entry.kind),
    ["payload"],
  );
  assert.equal(result.skeleton, "call [DATA_1] on it");
  assert.ok(!result.skeleton.includes("a9059cbb"), "no part of the payload may survive");
});

test("the names the mobile adapter re-exports all exist", () => {
  // android/src/minimise.ts maps App.tsx's long-standing import names onto the
  // core. If one of these is ever renamed here, the mobile build breaks at
  // bundle time rather than silently losing a redaction rule.
  for (const name of ["PROPOSE_KEEP", "KIND_LABELS", "minimise", "rehydrate", "residual"])
    assert.ok(name in exported, `the mobile adapter re-exports ${name}`);
  assert.deepEqual(exported.PROPOSE_KEEP, ["owner", "address", "amount"]);
});
