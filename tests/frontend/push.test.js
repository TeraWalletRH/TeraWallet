import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSubscription,
  consentMessage,
  pushText,
  pushesFor,
  worthPushing,
} from "../../public/tera/core/push.js";

const OWNER = "0x7777000000000000000000000000000000008888";
const OTHER = "0x5555000000000000000000000000000000006666";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const assets = { [USDG]: { symbol: "USDG", decimals: 6 } };
const e = (from, to, value, hash = "0xa", token = USDG) => ({ hash, token, from, to, value });

test("the wallet signs which wallet, which device, and what the lock screen shows", () => {
  const text = consentMessage({
    address: OWNER.toUpperCase().replace("0X", "0x"),
    device: "AB12",
    detail: "quiet",
    timestamp: 9,
  });
  assert.match(text, /Wallet: 0x7777/);
  assert.match(text, /Device: ab12/);
  assert.match(text, /Lock screen: no amounts/);
  assert.match(text, /Time: 9/);
});

test("incoming dust is skipped; outgoing is always told", () => {
  assert.equal(worthPushing(99n, 6, "receive"), false);
  assert.equal(worthPushing(100n, 6, "receive"), true);
  assert.equal(worthPushing(1n, 6, "send"), true);
});

test("pushes group a transaction's transfers and leave out unknown tokens", () => {
  const pushes = pushesFor(
    [
      e(OTHER, OWNER, "1000000"),
      e(OTHER, OWNER, "500000"),
      e(OTHER, OWNER, "9000000", "0xb", OTHER),
    ],
    OWNER,
    assets,
  );
  assert.deepEqual(
    pushes.map((p) => [p.direction, p.amount, p.symbol]),
    [["receive", "1.5", "USDG"]],
  );
});

test("the words never hold an address, and quiet holds no amount", () => {
  const loud = pushText({ direction: "send", symbol: "USDG", amount: "5" });
  assert.deepEqual(loud, {
    title: "Sent 5 USDG",
    body: "From your wallet. If this wasn't you, open Tera now.",
  });
  const quiet = pushText(
    { direction: "receive", symbol: "USDG", amount: "5" },
    { detail: "quiet" },
  );
  assert.equal(/5|USDG/.test(quiet.title + quiet.body), false);
  assert.equal(
    pushText({ direction: "receive", symbol: "USDG", amount: "5" }, { language: "zh" }).title,
    "收到 5 USDG",
  );
});

test("a subscription needs an https endpoint and well-formed keys", () => {
  const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
  assert.equal(checkSubscription({ endpoint: "https://push.example/1", keys }).ok, true);
  assert.equal(
    checkSubscription({ endpoint: "https://push.example/1", keys: { ...keys, p256dh: "x" } }).ok,
    false,
  );
  assert.equal(checkSubscription({ endpoint: "javascript:alert(1)", keys }).ok, false);
});
