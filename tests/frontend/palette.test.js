import { test } from "node:test";
import assert from "node:assert/strict";
import { matchScore, move, pastedAddress, rank } from "../../public/tera/core/palette.js";

const entries = [
  { id: "send", kind: "action", label: "Send", keywords: ["pay", "transfer"] },
  { id: "receive", kind: "action", label: "Receive", keywords: ["deposit", "address", "qr"] },
  { id: "swap", kind: "action", label: "Swap", keywords: ["trade", "exchange"] },
  { id: "settings", kind: "action", label: "Settings" },
  { id: "c:ana", kind: "contact", label: "Ana Souza", detail: "0x1111…1111" },
  { id: "c:sam", kind: "contact", label: "Sam's savings", detail: "0x2222…2222" },
  { id: "t:usdg", kind: "token", label: "USDG", detail: "Global Dollar" },
  { id: "t:eth", kind: "token", label: "ETH", detail: "Ether" },
];
const ids = (list) => list.map((e) => e.id);

test("match strength: prefix, word start, contains, letters in order", () => {
  assert.equal(matchScore("se", "Send"), 4);
  assert.equal(matchScore("sou", "Ana Souza"), 3);
  assert.equal(matchScore("ouz", "Ana Souza"), 2);
  assert.equal(matchScore("snd", "Send"), 1);
  assert.equal(matchScore("x", "Send"), 0);
  assert.equal(matchScore("s", "Send"), 4);
  assert.equal(matchScore("s", "USDG"), 0);
  assert.equal(matchScore("d", "USDG"), 0);
  assert.equal(matchScore("", "Send"), 0);
});

test("case and accents don't matter", () => {
  assert.equal(matchScore("JOSE", "José"), 4);
  assert.equal(matchScore("usdg", "USDG"), 4);
});

test("no query: the actions, in order", () => {
  assert.deepEqual(ids(rank(entries, "")), ["send", "receive", "swap", "settings"]);
  assert.deepEqual(ids(rank(entries, "  ", 2)), ["send", "receive"]);
});

test("labels outrank keywords; ties keep the given order", () => {
  // "s": prefix of Send, Swap, Settings, Sam's savings; word start of Ana Souza.
  assert.deepEqual(ids(rank(entries, "s")), ["send", "swap", "settings", "c:sam", "c:ana"]);
  // "pay" is only a keyword of Send.
  assert.deepEqual(ids(rank(entries, "pay")), ["send"]);
  // "dollar" finds USDG by its name.
  assert.deepEqual(ids(rank(entries, "dollar")), ["t:usdg"]);
});

test("finds contacts and tokens, capped at the limit", () => {
  assert.deepEqual(ids(rank(entries, "ana")), ["c:ana"]);
  assert.deepEqual(ids(rank(entries, "eth")), ["t:eth"]);
  assert.equal(rank(entries, "e", 1).length, 1);
});

test("a pasted address is recognised", () => {
  assert.equal(pastedAddress(" 0x00000000000000000000000000000000000000aB "), "0x00000000000000000000000000000000000000aB");
  assert.equal(pastedAddress("0x123"), "");
  assert.equal(pastedAddress("send"), "");
});

test("arrow keys wrap around", () => {
  assert.equal(move(0, 4, 1), 1);
  assert.equal(move(3, 4, 1), 0);
  assert.equal(move(0, 4, -1), 3);
  assert.equal(move(0, 0, 1), 0);
});
