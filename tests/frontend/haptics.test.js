import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENTS, PATTERNS, REPEAT_MS, forTone, plan } from "../../public/tera/core/haptics.js";
import { impersonates } from "../../public/tera/core/poisoning.js";

const NOW = 1_800_000_000_000;

test("five events, no two patterns alike, the lookalike the longest", () => {
  const shapes = EVENTS.map((e) => JSON.stringify(PATTERNS[e]));
  assert.equal(new Set(shapes).size, EVENTS.length);
  const length = (e) => PATTERNS[e].length;
  for (const e of EVENTS) if (e !== "lookalike") assert.ok(length("lookalike") > length(e));
  assert.equal(PATTERNS.lookalike[0].notification, "warning");
});

test("the same event twice within 400 ms plays once", () => {
  const last = { event: "error", at: NOW - 100 };
  assert.deepEqual(plan("error", { now: NOW, last }), []);
  assert.deepEqual(plan("error", { now: NOW + REPEAT_MS, last }), PATTERNS.error);
  assert.deepEqual(plan("success", { now: NOW, last }), PATTERNS.success);
});

test("a lookalike is never swallowed", () => {
  assert.deepEqual(plan("lookalike", { now: NOW, last: { event: "lookalike", at: NOW - 10 } }), PATTERNS.lookalike);
});

test("vibrations off: nothing, the lookalike included; unknown events: nothing", () => {
  for (const e of EVENTS) assert.deepEqual(plan(e, { enabled: false }), []);
  assert.deepEqual(plan("party"), []);
});

test("notices buzz by tone", () => {
  assert.equal(forTone("error"), "error");
  assert.equal(forTone("success"), "success");
  assert.equal(forTone(undefined), null);
});

const SAVED = "0x1234567890abcdef1234567890abcdef1234abcd";
const FAKE = "0x1234000000000000000000000000000000000bcd".replace("0bcd", "abcd");

test("a recipient imitating a saved address is caught; the real one and strangers aren't", () => {
  const known = [{ address: SAVED, name: "Ana" }];
  assert.equal(FAKE.length, 42);
  assert.equal(impersonates(FAKE, known)?.name, "Ana");
  assert.equal(impersonates(SAVED, known), null);
  assert.equal(impersonates(SAVED.toUpperCase().replace("0X", "0x"), known), null);
  assert.equal(impersonates("0x9999999999999999999999999999999999999999", known), null);
  assert.equal(impersonates("not an address", known), null);
  // Saved twice under different names, one exact: still the real thing.
  assert.equal(impersonates(SAVED, [{ address: FAKE, name: "x" }, ...known]), null);
});
