import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ENTRIES, MAX_TEXT, append, entryFor, messageText, search } from "../../public/tera/core/signature-log.js";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const SIG = `0x${"ab".repeat(65)}`;
const NOW = Date.UTC(2026, 9, 12);

test("a message entry: first line as title, full text, who asked, short signature", () => {
  const entry = entryFor({
    kind: "message",
    message: "Tera Wallet tag claim\nTag: jack\nTimestamp: 1",
    address: ADDRESS,
    site: "api.terawallet.app",
    signature: SIG,
    now: NOW,
  });
  assert.equal(entry.title, "Tera Wallet tag claim");
  assert.equal(entry.text, "Tera Wallet tag claim\nTag: jack\nTimestamp: 1");
  assert.equal(entry.site, "api.terawallet.app");
  assert.equal(entry.at, NOW);
  assert.equal(entry.signature, "0xabababab…abababab");
  assert.ok(entry.signature.length < 24);
});

test("raw bytes are shown as hex", () => {
  assert.equal(messageText({ raw: new Uint8Array([1, 2, 255]) }), "0x0102ff");
  assert.equal(messageText({ raw: "0xdead" }), "0xdead");
  assert.equal(entryFor({ kind: "message", message: "\n\n", signature: SIG }).title, "Empty message");
});

test("typed data: named by its type, content decoded with big numbers as text", () => {
  const entry = entryFor({
    kind: "typed",
    typed: {
      domain: { name: "Safe", chainId: 4663 },
      primaryType: "SafeTx",
      types: {},
      message: { to: ADDRESS, value: 10n ** 18n, nonce: 3n },
    },
    address: ADDRESS,
    signature: SIG,
  });
  assert.equal(entry.title, "Safe transaction");
  assert.equal(entry.detail, "Safe");
  assert.match(entry.text, /"value": "1000000000000000000"/);
  assert.equal(entryFor({ kind: "typed", typed: { primaryType: "Mail" } }).title, "Typed data: Mail");
});

test("very long content is cut and says so", () => {
  const entry = entryFor({ kind: "message", message: "x".repeat(MAX_TEXT + 50), signature: SIG });
  assert.ok(entry.text.startsWith("x".repeat(MAX_TEXT)));
  assert.match(entry.text, /cut at 4000 characters/);
});

test("newest first, capped at 200", () => {
  let log = null;
  for (let i = 0; i < MAX_ENTRIES + 5; i++) log = append(log, { at: i });
  assert.equal(log.items.length, MAX_ENTRIES);
  assert.equal(log.items[0].at, MAX_ENTRIES + 4);
  assert.equal(log.items.at(-1).at, 5);
});

test("nothing is added while logging is off", () => {
  const log = append({ off: true, items: [{ at: 1 }] }, { at: 2 });
  assert.deepEqual(log.items, [{ at: 1 }]);
});

test("search matches title, content, site and account", () => {
  const items = [
    { title: "Tera Wallet tag claim", text: "Tag: jack", site: "api.terawallet.app", address: ADDRESS },
    { title: "Safe transaction", text: "{}", site: "api.terawallet.app", address: "0x22" },
  ];
  assert.equal(search(items, "JACK").length, 1);
  assert.equal(search(items, "safe").length, 1);
  assert.equal(search(items, "0x1111").length, 1);
  assert.equal(search(items, "terawallet").length, 2);
  assert.equal(search(items, " ").length, 2);
});
