import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, looksAlike, splitPoisoned } from "../../public/tera/core/poisoning.js";

const real = "0xabcd111111111111111111111111111111111234";
const fake = "0xABCD999999999999999999999999999999991234";
const other = "0x5555000000000000000000000000000000006666";
const owner = "0x7777000000000000000000000000000000008888";
const chain = (counterpartyAddress, amount, createdAt, direction = "receive") => ({
  fromChain: true,
  counterpartyAddress,
  amount,
  createdAt,
  direction,
  hash: `${counterpartyAddress}-${createdAt}`,
});

test("lookalikes share the first and last four characters but are different addresses", () => {
  assert.equal(fingerprint(real), "abcd…1234");
  assert.equal(looksAlike(real, fake), true);
  assert.equal(looksAlike(real, real.toUpperCase().replace("0X", "0x")), false);
  assert.equal(looksAlike(real, other), false);
  assert.equal(looksAlike(real, "not an address"), false);
});

test("a zero-value transfer is hidden, whoever it is from", () => {
  const { shown, hidden } = splitPoisoned([chain(other, "0", 5), chain(other, "0.0", 6), chain(other, "12", 7)]);
  assert.deepEqual(hidden.map((r) => r.createdAt), [5, 6]);
  assert.deepEqual(shown.map((r) => r.createdAt), [7]);
});

test("the lookalike that arrives after a real payment is hidden, at any amount", () => {
  const rows = [chain(fake, "0.0001", 20), chain(fake, "500", 21), chain(real, "25", 10, "send")];
  const { shown, hidden } = splitPoisoned(rows);
  assert.deepEqual(shown.map((r) => r.counterpartyAddress), [real]);
  assert.equal(hidden.length, 2);
});

test("a saved contact or an address this device paid is genuine, even if seen later", () => {
  const rows = [chain(fake, "1", 1), chain(real, "1", 2)];
  assert.deepEqual(
    splitPoisoned(rows, [real]).shown.map((r) => r.counterpartyAddress),
    [real],
  );
  const signedHere = { recipient: real, createdAt: 3, title: "Sent 5 USDG" };
  const { shown, hidden } = splitPoisoned([...rows, signedHere]);
  assert.deepEqual(hidden.map((r) => r.counterpartyAddress), [fake]);
  assert.equal(shown.includes(signedHere), true);
});

test("a lookalike of the wallet itself is hidden", () => {
  const spoof = `0x7777${"e".repeat(32)}8888`;
  const { hidden } = splitPoisoned([chain(spoof, "3", 1, "send")], [owner]);
  assert.equal(hidden.length, 1);
});

test("rows this device signed always show, and order is kept", () => {
  const mine = { recipient: fake, amount: "0", createdAt: 9 };
  const rows = [chain(other, "1", 8), mine, chain(real, "1", 7)];
  const { shown, hidden } = splitPoisoned(rows, [real]);
  assert.deepEqual(shown, [rows[0], mine, rows[2]]);
  assert.deepEqual(hidden, []);
});

test("ordinary activity with no lookalikes is untouched", () => {
  const rows = [chain(real, "1", 1), chain(other, "2", 2)];
  assert.deepEqual(splitPoisoned(rows).shown, rows);
});
