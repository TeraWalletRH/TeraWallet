import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batch,
  checkWait,
  describe,
  formatAmount,
  forAddress,
  fresh,
} from "../../public/tera/core/notify.js";

const ME = "0xcd3b766ccdd6ae721141f452c550ca635964ce71";
const THEM = "0x00000000000000000000000000000000000000bb";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const assets = { [USDG]: { symbol: "USDG", decimals: 6 } };
const ev = (hash, from, to, value, token = USDG, block = 5) => ({
  hash,
  block,
  index: 0,
  token,
  from,
  to,
  value: String(value),
});

test("a transfer reads from the wallet's side, after the block asked for", () => {
  const events = [ev("0x1", THEM, ME, 1, USDG, 5), ev("0x2", ME, THEM, 1, USDG, 6)];
  assert.deepEqual(
    forAddress(events, ME.toUpperCase().replace("0X", "0x"), 5).map((e) => e.direction),
    ["send"],
  );
  assert.equal(forAddress(events, ME, 0)[0].direction, "receive");
});

test("one transaction's legs are folded per direction and token; unknown tokens are left out", () => {
  const lines = describe(
    forAddress([
      ev("0xa", THEM, ME, 20_000_000),
      ev("0xa", THEM, ME, 5_500_000),
      ev("0xa", ME, THEM, 1),
      ev("0xb", THEM, ME, 1, "0x00000000000000000000000000000000000000cc"),
    ], ME, 0),
    assets,
  );
  assert.equal(lines.length, 2);
  assert.deepEqual(
    { ...lines[0] },
    {
      hash: "0xa",
      direction: "receive",
      symbol: "USDG",
      decimals: 6,
      units: "25500000",
      amount: "25.5",
      counterparty: THEM,
    },
  );
  assert.equal(lines[1].direction, "send");
});

test("amounts are trimmed, grouped, and never shown as zero", () => {
  assert.equal(formatAmount(1_234_500_000n, 6), "1,234.5");
  assert.equal(formatAmount(10n ** 18n, 18), "1");
  assert.equal(formatAmount(1n, 18), "<0.000001");
  assert.equal(formatAmount(123_456_789n, 8), "1.234567");
});

test("what was announced, made here, or happened before listening is not announced again", () => {
  const items = [
    { hash: "0x1", direction: "receive", symbol: "USDG" },
    { hash: "0x1", direction: "receive", symbol: "USDG" },
    { hash: "0x2", direction: "receive", symbol: "ETH" },
    { hash: "0x3", direction: "send", symbol: "USDG" },
    { hash: "0x4", direction: "receive", symbol: "ETH", timestamp: 100 },
    { hash: "0x5", direction: "receive", symbol: "ETH", timestamp: 300 },
  ];
  const out = fresh(items, { seen: new Set(["0x2"]), own: new Set(["0x3"]), since: 200 });
  assert.deepEqual(
    out.map((i) => i.hash),
    ["0x1", "0x5"],
  );
});

test("a few arrive one by one; a pile after a reconnect is summed up", () => {
  assert.equal(batch([]), null);
  assert.equal(batch([{ direction: "receive" }]).kind, "each");
  const many = batch([
    { direction: "receive" },
    { direction: "receive" },
    { direction: "send" },
    { direction: "receive" },
  ]);
  assert.deepEqual({ kind: many.kind, received: many.received, sent: many.sent }, {
    kind: "summary",
    received: 3,
    sent: 1,
  });
});

test("a wait names a wallet and, optionally, a block number", () => {
  assert.equal(checkWait({}).ok, false);
  assert.deepEqual(checkWait({ address: ME }), { ok: true, address: ME, after: null });
  assert.equal(checkWait({ address: ME, after: "12" }).after, 12);
  assert.equal(checkWait({ address: ME, after: "1e5" }).ok, false);
});
