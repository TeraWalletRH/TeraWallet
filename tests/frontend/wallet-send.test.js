import { test } from "node:test";
import assert from "node:assert/strict";
import { describe } from "../../public/tera/core/dapp-send.js";
import {
  NATIVE,
  buildTransfer,
  checkAmount,
  checkRecipient,
  cleanRegistry,
  holdings,
  plainUnits,
  toUnits,
} from "../../public/tera/core/wallet-send.js";

const ME = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const AAPL = "0x1111111111111111111111111111111111111111";
const pinned = [
  { symbol: "USDG", name: "Global Dollar", address: USDG, decimals: 6 },
  { symbol: "ETH", name: "Ether", address: NATIVE, decimals: 18 },
];
const eth = pinned[1];
const usdg = pinned[0];

test("the registry is checked and can't relabel the wallet's own assets", () => {
  const assets = cleanRegistry(
    [
      { symbol: "AAPL", name: "Apple", address: AAPL, decimals: 18, status: "ACTIVE" },
      { symbol: "USDG", name: "Fake dollar", address: "0x" + "22".repeat(20), decimals: 6 },
      { symbol: "FAKE", address: USDG, decimals: 6 },
      { symbol: "BAD", address: "0x1234", decimals: 6 },
      { symbol: "DEC", address: "0x" + "33".repeat(20), decimals: 6.5 },
      { symbol: "<img>", address: "0x" + "44".repeat(20), decimals: 6 },
      { symbol: "OLD", address: "0x" + "55".repeat(20), decimals: 6, status: "PAUSED" },
      null,
    ],
    pinned,
  );
  assert.deepEqual(
    assets.map((a) => a.symbol),
    ["USDG", "ETH", "AAPL"],
  );
  assert.equal(cleanRegistry("not a list", pinned).length, 2);
});

test("ETH and USDG always show; anything else once it has a balance, by value", () => {
  const assets = [...pinned, { symbol: "AAPL", name: "Apple", address: AAPL, decimals: 18 }];
  const empty = holdings(assets, { [USDG]: "0", [NATIVE]: "0", [AAPL]: "0" }, {});
  assert.deepEqual(
    empty.map((r) => r.symbol),
    ["ETH", "USDG"],
  );
  const rows = holdings(
    assets,
    { [USDG]: "5000000", [NATIVE]: "1000000000000000000", [AAPL]: "2000000000000000000" },
    { USDG: 1, ETH: 2000, AAPL: 300 },
  );
  assert.deepEqual(
    rows.map((r) => [r.symbol, r.amount, r.value]),
    [
      ["ETH", "1", 2000],
      ["AAPL", "2", 600],
      ["USDG", "5", 5],
    ],
  );
  // A balance that couldn't be read is shown as unknown, not as zero.
  const unread = holdings(pinned, { [USDG]: null, [NATIVE]: "1" }, {});
  assert.equal(unread.find((r) => r.symbol === "USDG").amount, null);
});

test("amounts: plain decimals, within the asset's decimals, above zero", () => {
  assert.equal(toUnits("1.5", 6).units, 1500000n);
  assert.equal(toUnits(".25", 18).units, 250000000000000000n);
  assert.equal(toUnits("3", 0).units, 3n);
  assert.match(toUnits("1.0000001", 6).error, /6 decimal places/);
  assert.match(toUnits("0", 6).error, /above zero/);
  for (const bad of ["", ".", "1,5", "-1", "1e3", "0x10", " "]) assert.ok(toUnits(bad, 6).error);
  assert.equal(plainUnits(1500000n, 6), "1.5");
  assert.equal(plainUnits(1n, 18), "0.000000000000000001");
});

test("never more than the balance, and an unread balance isn't a zero", () => {
  assert.equal(checkAmount({ units: 5n, balance: "5", symbol: "USDG", decimals: 6 }), null);
  assert.match(
    checkAmount({ units: 6000000n, balance: "5000000", symbol: "USDG", decimals: 6 }),
    /more than your 5 USDG/,
  );
  assert.match(
    checkAmount({ units: 1n, balance: null, symbol: "ETH", decimals: 18 }),
    /Couldn't read/,
  );
});

test("recipients: valid, not the zero address, not the token's own contract", () => {
  assert.deepEqual(checkRecipient(` ${BOB} `, { owner: ME, asset: eth }), {
    address: BOB.toLowerCase(),
    self: false,
  });
  assert.equal(checkRecipient(ME, { owner: ME, asset: eth }).self, true);
  assert.match(checkRecipient("0x1234", { owner: ME, asset: eth }).error, /40 characters/);
  assert.match(checkRecipient(NATIVE, { owner: ME, asset: eth }).error, /zero address/);
  assert.match(checkRecipient(USDG, { owner: ME, asset: usdg }).error, /USDG contract itself/);
  // The USDG contract is a fine recipient for ETH (it would revert in simulation if not).
  assert.equal(checkRecipient(USDG, { owner: ME, asset: eth }).address, USDG);
});

test("a send is built as the review window will describe it", () => {
  const ethTx = buildTransfer({ owner: ME, asset: eth, to: BOB, units: 10n ** 16n });
  assert.deepEqual(ethTx, {
    from: ME,
    to: BOB.toLowerCase(),
    value: "0x2386f26fc10000",
    data: "0x",
  });
  assert.equal(describe(ethTx).title, "Send 0.01 ETH");

  const tokenTx = buildTransfer({ owner: ME, asset: usdg, to: BOB, units: 5000000n });
  assert.equal(tokenTx.to, USDG);
  assert.equal(tokenTx.value, "0x0");
  const described = describe(tokenTx, { tokens: { [USDG]: { symbol: "USDG", decimals: 6 } } });
  assert.equal(described.title, "Send 5 USDG");
  assert.equal(described.rows.find(([label]) => label === "To")[1], BOB.toLowerCase());
});
