import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeCalldata,
  describeTransaction,
  MAX_UINT256,
} from "../../public/tera/wallet/preview.js";
import { ZERO_ADDRESS } from "../../public/tera/wallet/core.js";

const chainId = 4663;
const owner = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const token = `0x${"3".repeat(40)}`;
const spender = `0x${"5".repeat(40)}`;
const hash = `0x${"4".repeat(64)}`;
const usdg = { symbol: "USDG", decimals: 6 };

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const addressWord = (address) => address.slice(2).toLowerCase().padStart(64, "0");
const transferData = (to, amount) => `0xa9059cbb${addressWord(to)}${word(amount)}`;
const approveData = (to, amount) => `0x095ea7b3${addressWord(to)}${word(amount)}`;

const tx = (overrides = {}) => ({
  to: token,
  data: transferData(recipient, 250000000n),
  value: "0x0",
  chainId,
  actionHash: hash,
  ...overrides,
});
const intent = (overrides = {}) => ({
  ownerAddress: owner,
  accountAddress: owner,
  assetAddress: token,
  recipient,
  actionType: "TRANSFER",
  amount: "250000000",
  ...overrides,
});

const texts = (preview) => preview.flags.map((entry) => entry.text).join(" | ");
const attention = (preview) => preview.flags.filter((entry) => entry.level === "attention");

test("a transfer decodes into its arguments", () => {
  const decoded = decodeCalldata(transferData(recipient, 250000000n));
  assert.equal(decoded.known, true);
  assert.equal(decoded.name, "transfer");
  assert.equal(decoded.signature, "transfer(address,uint256)");
  assert.equal(decoded.args[0].value, recipient.toLowerCase());
  assert.equal(decoded.args[1].value, "250000000");
  assert.equal(decoded.extraWords, 0);
});

test("empty calldata is a native transfer, not an unknown function", () => {
  for (const data of ["0x", "", undefined]) {
    const decoded = decodeCalldata(data);
    assert.equal(decoded.native, true);
    assert.equal(decoded.known, true);
  }
});

test("the sentence names the amount, recipient and network", () => {
  const preview = describeTransaction({
    tx: tx(),
    intent: intent(),
    asset: usdg,
    chainId,
    networkName: "Robinhood Chain",
  });
  assert.equal(preview.action, "Move a token you hold");
  assert.match(preview.sentence, /Send 250 USDG to 0x2{40} on Robinhood Chain \(chain 4663\)\./);
  assert.deepEqual(attention(preview), []);
});

test("the raw fields are always shown in full", () => {
  const preview = describeTransaction({ tx: tx(), intent: intent(), asset: usdg, chainId });
  const rows = Object.fromEntries(preview.rows.map((row) => [row.label, row.value]));
  assert.equal(rows["Sends to"], token);
  assert.equal(rows["Value"], "0 wei");
  assert.equal(rows["Function"], "transfer(address,uint256)");
  assert.equal(rows["Calldata"], transferData(recipient, 250000000n));
  assert.equal(rows["Action reference"], hash);
  assert.equal(rows["↳ recipient"], recipient.toLowerCase());
  assert.equal(rows["↳ amount"], "250000000");
});

test("an allowance is described as persistent, not as a payment", () => {
  const preview = describeTransaction({
    tx: tx({ data: approveData(spender, 250000000n) }),
    intent: intent(),
    asset: usdg,
    chainId,
  });
  assert.equal(preview.action, "Grant a spending allowance");
  assert.match(preview.sentence, /Allow 0x5{40} to spend 250 USDG/);
  assert.match(preview.sentence, /stays in place until you change it/);
  assert.match(texts(preview), /not a one-off payment/);
});

test("an unlimited allowance is flagged for attention", () => {
  const preview = describeTransaction({
    tx: tx({ data: approveData(spender, MAX_UINT256) }),
    intent: intent(),
    asset: usdg,
    chainId,
  });
  assert.match(preview.sentence, /an unlimited amount of USDG/);
  assert.match(texts(preview), /effectively unlimited allowance/);
  assert.ok(attention(preview).length >= 1);
});

test("an unrecognised function is never described as a transfer", () => {
  const preview = describeTransaction({
    tx: tx({ data: `0xdeadbeef${addressWord(recipient)}${word(1n)}` }),
    intent: intent(),
    asset: usdg,
    chainId,
  });
  assert.equal(preview.action, "Unrecognised function");
  assert.match(preview.sentence, /unrecognised function \(0xdeadbeef\)/);
  assert.equal(/^Send /.test(preview.sentence), false);
  assert.equal(preview.sentence.includes("250 USDG"), false);
  assert.match(texts(preview), /not one this wallet can decode/);
});

test("a token call that also carries value is flagged", () => {
  const preview = describeTransaction({
    tx: tx({ value: "1000000000000000000" }),
    intent: intent(),
    asset: usdg,
    chainId,
  });
  assert.match(texts(preview), /also sends the network's own token/);
});

test("extra words beyond the signature are flagged", () => {
  const preview = describeTransaction({
    tx: tx({ data: `${transferData(recipient, 250000000n)}${word(7n)}` }),
    intent: intent(),
    asset: usdg,
    chainId,
  });
  assert.match(texts(preview), /1 extra word beyond/);
});

test("unrecoverable destinations are flagged", () => {
  const burn = describeTransaction({
    tx: tx({ data: transferData(ZERO_ADDRESS, 1n) }),
    intent: intent({ recipient: ZERO_ADDRESS, amount: "1" }),
    asset: usdg,
    chainId,
  });
  assert.match(texts(burn), /zero address/);
  const self = describeTransaction({
    tx: tx({ data: transferData(token, 1n) }),
    intent: intent({ recipient: token, amount: "1" }),
    asset: usdg,
    chainId,
  });
  assert.match(texts(self), /token contract itself/);
});

test("a payload that disagrees with the proposal is flagged on both fields", () => {
  const preview = describeTransaction({
    tx: tx({ data: transferData(`0x${"9".repeat(40)}`, 999999999n) }),
    intent: intent(),
    asset: usdg,
    chainId,
  });
  assert.match(texts(preview), /recipient in the payload is not the recipient in this proposal/);
  assert.match(texts(preview), /amount in the payload is not the amount in this proposal/);
});

test("an unknown asset reports base units rather than inventing a precision", () => {
  const preview = describeTransaction({ tx: tx(), intent: intent(), asset: null, chainId });
  assert.match(preview.sentence, /250000000 base units/);
  assert.equal(preview.sentence.includes("USDG"), false);
});

test("a missing transaction yields no preview at all", () => {
  assert.equal(describeTransaction({}), null);
  assert.equal(describeTransaction(), null);
});
