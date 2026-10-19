import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLES,
  SAVE,
  SEND,
  UNKNOWN,
  amountFor,
  applySave,
  read,
} from "../../public/tera/core/tera-go.js";

const ME = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const MOM = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const PASCAL = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const usdg = { symbol: "USDG", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6 };
const eth = { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18 };
const tera = {
  symbol: "TERA",
  address: "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8",
  decimals: 18,
};
const weth = {
  symbol: "WETH",
  address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  decimals: 18,
  priceAs: "ETH",
};
const assets = [usdg, eth, tera, weth];
const book = [
  { address: MOM, name: "Mom", savedAt: 1 },
  { address: PASCAL, name: "Pascal", savedAt: 2 },
  { address: "0x90f79bf6eb2c4f870365e785982e1f101e93b906", name: "Big Sis", savedAt: 3 },
];
const ctx = { assets, book, owner: ME };
const go = (text) => read(text, ctx);

test("your sentences: dollars of an asset to a saved contact", () => {
  assert.deepEqual(go("send $2 worth of USDG to mom"), {
    kind: SEND,
    asset: usdg,
    amount: "2",
    to: { kind: "contact", name: "Mom", address: MOM },
  });
  for (const text of [
    "send $2 of ETH to mom",
    "send 2 dollars worth of eth to Mom",
    "send 2$ of ETH to MOM",
    "Send $2 in ETH to mom.",
    "pay mom $2 worth of ETH",
  ]) {
    const r = go(text);
    assert.equal(r.kind, SEND, text);
    assert.equal(r.asset, eth, text);
    assert.equal(r.usd, "2", text);
    assert.equal(r.to.address, MOM, text);
  }
});

test("Plainly's shapes: name first or last, units or dollars, address, tag", () => {
  assert.deepEqual(go("send pascal 10 USDG"), {
    kind: SEND,
    asset: usdg,
    amount: "10",
    to: { kind: "contact", name: "Pascal", address: PASCAL },
  });
  assert.equal(go("pay pascal 10 usdg").amount, "10");
  assert.equal(go("transfer 1,250.75 USDG to pascal").amount, "1250.75");
  const toAddress = go(`send 0.05 ETH to ${MOM.toUpperCase().replace("0X", "0x")}`);
  assert.deepEqual(toAddress.to, { kind: "address", address: MOM });
  assert.equal(toAddress.amount, "0.05");
  assert.deepEqual(go("send .5 eth to @astra").to, { kind: "tag", tag: "astra" });
  assert.equal(go("give big sis 3 TERA").to.name, "Big Sis");
  assert.equal(go("please send 3 tera to BigSis").to.name, "Big Sis");
});

test("dollars with no asset are USDG; a bare number is refused", () => {
  const r = go("send $5 to mom");
  assert.equal(r.asset, usdg);
  assert.equal(r.amount, "5");
  assert.equal(r.usd, undefined);
  assert.equal(go("send 5 usd to mom").amount, "5");
  assert.equal(go("send 5 dollars to mom").asset, usdg);
  const bare = go("send 5 to mom");
  assert.equal(bare.kind, UNKNOWN);
  assert.match(bare.reason, /Say which asset/);
  assert.match(go("pay mom 5").reason, /Say which asset/);
});

test("never guesses a recipient", () => {
  const typo = go("send $5 to mum");
  assert.equal(typo.kind, UNKNOWN);
  assert.match(typo.reason, /don't have a contact called "mum"/);
  assert.match(typo.reason, /save wallet as mum/);
  // Close saved names are offered, not used.
  assert.match(go("send $5 to pasc").reason, /Did you mean "Pascal"\?/);
  assert.match(go("send $5 to 0x7099").reason, /isn't complete/);
  assert.match(go("send $5 to me").reason, /your own wallet/);
  assert.match(go(`send $5 to ${ME}`).reason, /your own wallet/);
  assert.match(go("send $5 to @A").reason, /isn't a valid Tera tag/);
  assert.equal(go("send 10 USDG to mom and 5 USDG to pascal").kind, UNKNOWN);
});

test("unknown assets and sentences are refused with examples", () => {
  assert.match(go("send 10 DOGE to mom").reason, /doesn't know an asset called DOGE/);
  const r = go("what's the weather");
  assert.equal(r.kind, UNKNOWN);
  assert.deepEqual(r.examples, EXAMPLES);
  assert.equal(go("").kind, UNKNOWN);
  assert.equal(go("send mom").kind, UNKNOWN);
  assert.equal(
    read("send $5 to mom", { ...ctx, assets: [eth] }).reason,
    "USDG isn't in Tera's asset list right now.",
  );
});

test("save: the last wallet paid, or an address", () => {
  for (const text of [
    "save wallet as mom",
    "save this wallet as mom",
    "save it as mom",
    "save as mom",
    "name it mom",
    "save that address as mom",
  ])
    assert.deepEqual(go(text), { kind: SAVE, target: { kind: "last" }, name: "mom" }, text);
  assert.deepEqual(go(`save ${MOM} as Mom`), {
    kind: SAVE,
    target: { kind: "address", address: MOM },
    name: "Mom",
  });
  assert.match(go("save wallet as @mom").reason, /cannot start with @/);
  assert.match(go("save @astra as friend").reason, /tag already has a name/);
  assert.match(go("save pascal as dad").reason, /Say which wallet to save/);
});

test("a save goes through the contact rules", () => {
  const fresh = "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65";
  const saved = applySave(go("save wallet as Uncle Ben"), {
    book,
    lastPayee: fresh,
    owner: ME,
    now: 9,
  });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.contact, { address: fresh, name: "Uncle Ben", savedAt: 9 });
  assert.equal(read("send $1 to uncle ben", { ...ctx, book: saved.book }).to.address, fresh);
  // One name, one address.
  assert.match(
    applySave(go("save wallet as mom"), { book, lastPayee: fresh, owner: ME }).reason,
    /already the name/,
  );
  assert.match(
    applySave(go("save wallet as mom"), { book, lastPayee: "", owner: ME }).reason,
    /no recent payment/,
  );
  assert.match(applySave(go(`save ${ME} as me`), { book, owner: ME }).reason, /your own wallet/);
});

test("amounts: units exactly, dollars at the live price rounded down", () => {
  assert.deepEqual(amountFor(go("send pascal 10 USDG")), { units: 10_000_000n, amount: "10" });
  assert.match(amountFor(go("send 1.0000001 USDG to mom")).error, /6 decimal places/);
  assert.match(amountFor(go("send 0 USDG to mom")).error, /above zero/);
  const twoDollarsOfEth = amountFor(go("send $2 of ETH to mom"), { prices: { ETH: 2000 } });
  assert.equal(twoDollarsOfEth.units, 1_000_000_000_000_000n);
  assert.equal(twoDollarsOfEth.amount, "0.001");
  assert.equal(twoDollarsOfEth.usd, "2");
  // WETH is priced as ETH.
  assert.equal(amountFor(go("send $2 of WETH to mom"), { prices: { ETH: 2000 } }).amount, "0.001");
  assert.match(amountFor(go("send $2 of TERA to mom"), { prices: {} }).error, /no price for TERA/);
});
