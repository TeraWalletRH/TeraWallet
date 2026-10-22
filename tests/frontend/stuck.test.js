import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANCELLED,
  CONFIRMED,
  EXPLAIN,
  MISSING,
  REPLACED,
  REVERTED,
  STUCK_AFTER,
  UNKNOWN,
  WAITING,
  cancelState,
  classify,
  looksStuck,
} from "../../public/tera/core/stuck.js";

const NOW = 1_800_000_000_000;
const row = (over = {}) => ({
  hash: "0xabc",
  status: "pending",
  createdAt: NOW - STUCK_AFTER,
  ...over,
});

test("help is offered only for open rows older than a minute", () => {
  assert.equal(looksStuck(row(), NOW), true);
  assert.equal(looksStuck(row({ status: "broadcasting" }), NOW), true);
  assert.equal(looksStuck(row({ status: "cancelling" }), NOW), true);
  assert.equal(looksStuck(row({ createdAt: NOW - STUCK_AFTER + 1 }), NOW), false);
  for (const status of ["confirmed", "reverted", "cancelled", "replaced"])
    assert.equal(looksStuck(row({ status }), NOW), false, status);
  assert.equal(looksStuck(row({ hash: "" }), NOW), false);
  assert.equal(looksStuck(row({ createdAt: undefined }), NOW), false);
  assert.equal(looksStuck(null, NOW), false);
  // Sent again or cancelled: the minute starts over.
  assert.equal(looksStuck(row({ retriedAt: NOW - 1000 }), NOW), false);
  assert.equal(looksStuck(row({ retriedAt: NOW - STUCK_AFTER }), NOW), true);
});

test("a receipt settles it", () => {
  assert.deepEqual(classify({ receipt: "success", known: true, nonce: 4, used: 5 }), {
    state: CONFIRMED,
    actions: [],
  });
  assert.deepEqual(classify({ receipt: "reverted", known: true, nonce: 4, used: 5 }), {
    state: REVERTED,
    actions: [],
  });
});

test("a slot filled by another transaction means it can never land", () => {
  assert.deepEqual(classify({ receipt: null, known: false, nonce: 4, used: 5 }), {
    state: REPLACED,
    actions: [],
  });
  // Even if a node still remembers it.
  assert.equal(classify({ receipt: null, known: true, nonce: 4, used: 9 }).state, REPLACED);
});

test("never arrived: send again or cancel; held: cancel only", () => {
  assert.deepEqual(classify({ receipt: null, known: false, nonce: 4, used: 4 }), {
    state: MISSING,
    actions: ["again", "cancel"],
  });
  assert.deepEqual(classify({ receipt: null, known: true, nonce: 4, used: 3 }), {
    state: WAITING,
    actions: ["cancel"],
  });
  // The count couldn't be read: still safe, because any retry uses the same slot.
  assert.equal(classify({ receipt: null, known: false, nonce: 0, used: null }).state, MISSING);
});

test("no recorded slot, no actions: a retry could pay twice", () => {
  for (const nonce of [null, undefined, -1, 1.5])
    assert.deepEqual(
      classify({ receipt: null, known: false, nonce, used: 3 }),
      { state: UNKNOWN, actions: [] },
      String(nonce),
    );
});

test("a cancel reads cancelled only once it confirms, and the original can still win", () => {
  assert.equal(cancelState({ original: null, cancel: null }), "cancelling");
  assert.equal(cancelState({ original: null, cancel: "success" }), CANCELLED);
  assert.equal(cancelState({ original: "success", cancel: null }), CONFIRMED);
  assert.equal(cancelState({ original: "reverted", cancel: null }), REVERTED);
});

test("every state has words", () => {
  for (const state of [CONFIRMED, REVERTED, WAITING, MISSING, REPLACED, UNKNOWN, CANCELLED])
    assert.ok(EXPLAIN[state]?.length > 20, state);
});
