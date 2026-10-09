import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHidden, sortFound, spamReason, toggle } from "../../public/tera/core/spam.js";

const known = [
  { symbol: "USDG", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" },
  { symbol: "TERA", address: "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8" },
];
const token = (over) => ({
  address: `0x${"a".repeat(40)}`,
  symbol: "LINK",
  name: "Chainlink",
  decimals: 18,
  exchangeRate: "12.79",
  reputation: "ok",
  value: "1000",
  ...over,
});

test("a priced, unflagged token with a plain name may be shown", () => {
  assert.equal(spamReason(token()), null);
});

test("no price means spam: the airdrop nobody can sell", () => {
  assert.equal(spamReason(token({ symbol: "DOG", name: "Stray Dog", exchangeRate: null })), "unpriced");
  assert.equal(spamReason(token({ exchangeRate: "0" })), "unpriced");
});

test("adverts and links in the name are spam, priced or not", () => {
  for (const name of ["Claim at usdg-reward.xyz", "Visit https://x", "AIRDROP $1000", "t.me/scam", "Free USDG voucher"])
    assert.equal(spamReason(token({ name })), "bait", name);
  assert.equal(spamReason(token({ symbol: "WWW.GIFT" })), "bait");
});

test("the explorer's own flag is spam", () => {
  assert.equal(spamReason(token({ reputation: "scam" })), "scam");
});

test("a second USDG from another contract is an impostor even with a price", () => {
  const { show, spam } = sortFound([token({ symbol: "usdg", name: "USDG" })], known);
  assert.equal(show.length, 0);
  assert.equal(spam[0].reason, "impostor");
});

test("tokens Tera already lists and empty balances are left alone", () => {
  const found = [
    token({ address: known[1].address, symbol: "TERA", exchangeRate: null }),
    token({ address: `0x${"b".repeat(40)}`, value: "0" }),
    token({ address: `0x${"c".repeat(40)}` }),
    token({ address: `0x${"d".repeat(40)}`, symbol: "DOG", exchangeRate: null }),
  ];
  const { show, spam } = sortFound(found, known);
  assert.deepEqual(show.map((t) => t.address), [`0x${"c".repeat(40)}`]);
  assert.deepEqual(spam.map((t) => [t.symbol, t.reason]), [["DOG", "unpriced"]]);
});

test("a spam token the owner allows is shown", () => {
  const dog = token({ address: `0x${"D".repeat(40)}`, symbol: "DOG", exchangeRate: null });
  const { show, spam } = sortFound([dog], known, [`0x${"d".repeat(40)}`]);
  assert.equal(show.length, 1);
  assert.equal(spam.length, 0);
});

test("the owner's hide list takes rows off the home list, and can be undone", () => {
  const rows = [{ address: "0xAA" }, { address: "0xbb" }];
  let hidden = toggle([], "0xaa", true);
  assert.deepEqual(applyHidden(rows, hidden).shown, [rows[1]]);
  hidden = toggle(toggle(hidden, "0xAA", true), "0xaa", false);
  assert.deepEqual(hidden, []);
  assert.deepEqual(applyHidden(rows, hidden).shown, rows);
});

test("a second unknown token with the same symbol is a copy", () => {
  const first = token({ address: `0x${"e".repeat(40)}` });
  const copy = token({ address: `0x${"f".repeat(40)}` });
  const { show, spam } = sortFound([first, copy], known);
  assert.deepEqual(show, [first]);
  assert.equal(spam[0].reason, "impostor");
});
