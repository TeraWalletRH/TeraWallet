import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  headline,
  rows,
  claims,
  text,
  exitCode,
  PASS,
  FAIL,
  UNVERIFIABLE,
  SKIPPED,
} from "../../public/tera/core/report.js";
import { create, bundle, verify } from "../../public/tera/core/receipt.js";

globalThis.crypto ??= webcrypto;
globalThis.btoa ??= (binary) => Buffer.from(binary, "binary").toString("base64");

const TURN = { input: "what does the policy check do?", output: "It checks the signed bundle." };

const made = (overrides = {}) =>
  create({
    answeredBy: "code",
    input: TURN.input,
    output: TURN.output,
    release: "r-d5b1ca767477",
    integrity: "verified",
    module: "checks.js",
    at: Date.UTC(2026, 8, 18, 12, 0, 0),
    ...overrides,
  });

const check = (status, id = status) => ({ id, label: id, status, detail: `${id} detail` });

test("a failure is the headline, however many checks passed", () => {
  const summary = headline([check(PASS, "a"), check(PASS, "b"), check(FAIL, "c")]);
  assert.equal(summary.status, FAIL);
  assert.match(summary.line, /does not describe the turn it claims to/i);
  assert.doesNotMatch(summary.line, /passed/i, "a failed set must not lead with a count of passes");
});

test("an unproven claim is never reported as a pass, and never as a failure", () => {
  const summary = headline([check(PASS, "a"), check(UNVERIFIABLE, "b")]);
  assert.equal(summary.status, UNVERIFIABLE);
  assert.match(summary.line, /could not be established/i);
  assert.doesNotMatch(summary.line, /failed/i);
});

test("nothing checked is not the same sentence as everything passed", () => {
  assert.match(headline([]).line, /Nothing was checked/i);
  assert.equal(headline([]).status, SKIPPED);
  assert.match(headline([check(SKIPPED, "a")]).line, /No check could run/i);
});

test("rows come back worst first, and nothing is dropped", () => {
  const given = [check(SKIPPED), check(PASS), check(UNVERIFIABLE), check(FAIL)];
  const order = rows(given).map((row) => row.status);
  assert.deepEqual(order, [FAIL, UNVERIFIABLE, PASS, SKIPPED]);
  assert.equal(rows(given).length, given.length, "a shorter report reads as a better result");
});

test("rows carry the receipt vocabulary, not the gate vocabulary", () => {
  // "Blocked" belongs to an action that was stopped. A receipt reports on
  // something already done, so the same state has to read as "Failed".
  const [failed] = rows([check(FAIL)]);
  assert.equal(failed.mark, "Failed");
  assert.equal(rows([check(SKIPPED)])[0].mark, "Not applicable");
});

test("what the file claims is kept apart from what was checked", async () => {
  const receipt = await made();
  const stated = claims(receipt);
  const labels = stated.map((entry) => entry.label);
  assert.ok(labels.includes("Build release"));
  assert.ok(labels.includes("Answered by"));
  // Empty fields are absent rather than shown blank: a row reading "Model —"
  // invites the reader to think a model was checked and found wanting.
  assert.ok(!labels.includes("Model"));
  assert.ok(!labels.includes("Signed by"));
});

test("the text report names the claims as unchecked, in the report itself", async () => {
  const receipt = await made();
  const report = text(await verify(bundle(receipt, TURN)), receipt);
  assert.match(report, /None of the above is checked by this tool/i);
  assert.match(report, /\[PASS\] Message commitment/);
  assert.match(report, /passed, 0 failed/);
});

test("the exit code separates unproven from both passing and failing", async () => {
  const receipt = await made();
  const sound = await verify(bundle(receipt, TURN));
  assert.equal(exitCode(sound), 2, "a receipt with unproven claims is not a clean pass");

  const tampered = await verify(bundle(receipt, { ...TURN, output: `${TURN.output}!` }));
  assert.equal(exitCode(tampered), 1);

  assert.equal(exitCode({ checks: [check(PASS)] }), 0);
  assert.equal(exitCode({}), 0);
});

test("a real tampered receipt reads as failed from end to end", async () => {
  const receipt = await made();
  const result = await verify(bundle(receipt, { ...TURN, output: "something else entirely" }));
  const summary = headline(result.checks);
  assert.equal(summary.status, FAIL);
  assert.equal(rows(result.checks)[0].status, FAIL, "the failure has to be the first row read");
});
