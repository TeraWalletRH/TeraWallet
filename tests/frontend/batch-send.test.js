import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PAYMENTS, parseBatch, repeatedAddress } from "../../public/tera/core/batch-send.js";

const ME = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const MOM = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const PASCAL = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const usdg = { symbol: "USDG", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6 };
const tera = {
  symbol: "TERA",
  address: "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8",
  decimals: 18,
};
const book = [
  { address: MOM, name: "Mom", savedAt: 1 },
  { address: PASCAL, name: "Big Sis", savedAt: 2 },
];
const read = (text, asset = usdg, prices = {}) =>
  parseBatch(text, { asset, book, owner: ME, prices });

test("one payment a line, in the shapes a pasted list comes in", () => {
  const r = read(
    [
      "recipient, amount",
      "mom 10",
      "",
      "@astra, 5",
      `${"0x90f79bf6eb2c4f870365e785982e1f101e93b906"}\t$2.50`,
      "1,250 to Big Sis",
      "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65; 3 USDG",
    ].join("\n"),
  );
  assert.equal(r.ready, true, JSON.stringify(r.errors));
  assert.deepEqual(
    r.payments.map((p) => [p.line, p.to.kind, p.amount]),
    [
      [2, "contact", "10"],
      [4, "tag", "5"],
      [5, "address", "2.5"],
      [6, "contact", "1250"],
      [7, "address", "3"],
    ],
  );
  assert.equal(r.total, 1270_500_000n);
});

test("dollars of another asset use the live price; a different asset is refused", () => {
  const r = read("mom $5", tera, { TERA: 0.01 });
  assert.equal(r.payments[0].amount, "500");
  assert.equal(r.payments[0].usd, "5");
  assert.match(read("mom 10 ETH").errors[0].error, /This list sends USDG; this line says ETH/);
  assert.match(read("mom $5", tera).errors[0].error, /no price for TERA/);
});

test("every bad line says why, and the list can't be sent", () => {
  const r = read(["mom 10", "mum 5", "mom", "me 3", "0x1234 4", "Big Sis 0"].join("\n"));
  assert.equal(r.ready, false);
  assert.deepEqual(
    r.errors.map((e) => e.line),
    [2, 3, 4, 5, 6],
  );
  assert.match(r.errors[0].error, /don't have a contact called "mum"/);
  assert.match(r.errors[1].error, /who, then how much/);
  assert.match(r.errors[2].error, /your own wallet/);
  assert.match(r.errors[3].error, /isn't complete/);
  assert.match(r.errors[4].error, /above zero/);
  assert.equal(r.problem, "5 lines need fixing before this can be sent.");
});

test("the same recipient twice is refused with both lines", () => {
  const r = read(
    ["mom 10", `${MOM.toUpperCase().replace("0X", "0x")} 5`, "@astra 1", "@Astra 2"].join("\n"),
  );
  assert.deepEqual(
    r.errors.map((e) => [e.line, e.error]),
    [
      [2, "Same recipient as line 1. Combine them into one line, or remove one."],
      [4, "Same recipient as line 3. Combine them into one line, or remove one."],
    ],
  );
  assert.equal(repeatedAddress([MOM, PASCAL, MOM.toUpperCase()]), MOM.toUpperCase());
  assert.equal(repeatedAddress([MOM, PASCAL]), "");
});

test(`at most ${MAX_PAYMENTS} at a time; empty is not ready`, () => {
  const many = Array.from(
    { length: MAX_PAYMENTS + 1 },
    (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")} 1`,
  ).join("\n");
  const r = read(many);
  assert.equal(r.ready, false);
  assert.match(r.problem, /at most 25/);
  assert.equal(read("").ready, false);
  assert.equal(read("   \n  ").payments.length, 0);
});
