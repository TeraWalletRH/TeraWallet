import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL,
  APPROVAL_FOR_ALL,
  NATIVE,
  TRANSFER,
  amountText,
  changesFrom,
  describe,
} from "../../public/tera/core/balance-changes.js";

const ME = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const MOM = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const ROUTER = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const POOL = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const TERA = "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8";
const ODD = "0x5db4000000000000000000000000000000f877aa";
const NFT = "0x1111111111111111111111111111111111111111";
const topic = (address) => `0x${"0".repeat(24)}${address.slice(2)}`;
const word = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
const transfer = (token, from, to, amount) => ({
  address: token,
  topics: [TRANSFER, topic(from), topic(to)],
  data: word(amount),
});
const ok = (...logs) => ({ status: "0x1", logs });
const known = {
  [USDG]: { symbol: "USDG", decimals: 6, known: true },
  [TERA]: { symbol: "TERA", decimals: 18, known: true },
  [NATIVE]: { symbol: "ETH", decimals: 18, known: true },
};

test("a payment: what leaves this wallet, nothing about the hops after", () => {
  const changes = changesFrom(
    [ok(transfer(NATIVE, ME, MOM, 10n ** 15n), transfer(NATIVE, MOM, POOL, 1n))],
    ME,
  );
  assert.deepEqual(changes.tokens, [{ token: NATIVE, delta: -(10n ** 15n) }]);
  const shown = describe(changes, { known, prices: { ETH: 2500 } });
  assert.equal(shown.pays[0].formatted, "-0.001 ETH");
  assert.equal(shown.pays[0].usd, 2.5);
  assert.equal(shown.receives.length, 0);
  assert.equal(shown.summary, "You send 0.001 ETH");
});

test("a swap over two steps: approval, then USDG out and TERA in", () => {
  const approve = {
    address: USDG,
    topics: [APPROVAL, topic(ME), topic(ROUTER)],
    data: word(20_000_000),
  };
  const changes = changesFrom(
    [
      ok(approve),
      ok(
        transfer(USDG, ME, ROUTER, 20_000_000),
        transfer(USDG, ROUTER, POOL, 20_000_000),
        transfer(TERA, POOL, ROUTER, 5n * 10n ** 18n),
        transfer(TERA, ROUTER, ME, 5n * 10n ** 18n),
      ),
    ],
    ME,
  );
  const shown = describe(changes, { known, prices: { USDG: 1 } });
  assert.deepEqual(
    shown.pays.map((p) => p.formatted),
    ["-20 USDG"],
  );
  assert.deepEqual(
    shown.receives.map((r) => r.formatted),
    ["+5 TERA"],
  );
  assert.equal(shown.receives[0].usd, undefined);
  assert.deepEqual(shown.approvals, ["Lets 0x3c44…93bc spend up to 20 USDG"]);
  assert.equal(shown.summary, "You send 20 USDG and you get 5 TERA");
});

test("in and out again is no change; a used-up approval isn't shown", () => {
  const changes = changesFrom(
    [
      ok(
        { address: USDG, topics: [APPROVAL, topic(ME), topic(ROUTER)], data: word(5) },
        { address: USDG, topics: [APPROVAL, topic(ME), topic(ROUTER)], data: word(0) },
        transfer(USDG, POOL, ME, 5),
        transfer(USDG, ME, ROUTER, 5),
      ),
    ],
    ME,
  );
  assert.deepEqual(changes.tokens, []);
  assert.deepEqual(changes.approvals, []);
  const shown = describe(changes, { known });
  assert.equal(shown.hasDeltas, false);
  assert.equal(shown.summary, "No balance changes");
});

test("an unknown token is shown and flagged; unlimited and collection-wide approvals say so", () => {
  const changes = changesFrom(
    [
      ok(
        transfer(ODD, POOL, ME, 50n * 10n ** 18n),
        {
          address: USDG,
          topics: [APPROVAL, topic(ME), topic(ROUTER)],
          data: word(2n ** 256n - 1n),
        },
        { address: NFT, topics: [APPROVAL_FOR_ALL, topic(ME), topic(ROUTER)], data: word(1) },
      ),
    ],
    ME,
  );
  const named = describe(changes, { known: { ...known, [ODD]: { symbol: "USDG", decimals: 18 } } });
  assert.equal(named.unknownToken, true);
  assert.equal(named.receives[0].formatted, "+50 USDG");
  assert.equal(named.receives[0].unknown, true);
  // A lookalike symbol gets no price.
  assert.equal(
    describe(changes, {
      known: { ...known, [ODD]: { symbol: "USDG", decimals: 18 } },
      prices: { USDG: 1 },
    }).receives[0].usd,
    undefined,
  );
  assert.equal(
    describe(changes, { known }).receives[0].formatted,
    `+${(50n * 10n ** 18n).toString()} 0x5db4…77aa`,
  );
  assert.deepEqual(named.approvals, [
    "Lets 0x3c44…93bc spend unlimited USDG",
    "Lets 0x3c44…93bc move every 0x1111…1111 you hold",
  ]);
});

test("a known spender is named", () => {
  const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const changes = changesFrom(
    [
      ok({
        address: TERA,
        topics: [APPROVAL, topic(ME), topic(permit2.toLowerCase())],
        data: word(10n ** 21n),
      }),
    ],
    ME,
  );
  assert.deepEqual(describe(changes, { known }).approvals, [
    "Lets Uniswap's Permit2 spend up to 1,000 TERA",
  ]);
});

test("NFTs by collection and number", () => {
  const nftTransfer = (from, to, id) => ({
    address: NFT,
    topics: [TRANSFER, topic(from), topic(to), word(id)],
    data: "0x",
  });
  const shown = describe(changesFrom([ok(nftTransfer(ME, MOM, 7), nftTransfer(POOL, ME, 9))], ME), {
    known: { [NFT]: { symbol: "Punks", decimals: 0, known: true } },
  });
  assert.deepEqual(
    shown.pays.map((p) => p.formatted),
    ["-Punks #7"],
  );
  assert.deepEqual(
    shown.receives.map((r) => r.formatted),
    ["+Punks #9"],
  );
});

test("a failed step says which, and claims nothing else", () => {
  const failed = changesFrom(
    [
      ok(transfer(USDG, ME, MOM, 1)),
      { status: "0x0", logs: [], error: { message: "execution reverted" } },
    ],
    ME,
  );
  assert.deepEqual(failed, { ok: false, failedAt: 1, reason: "execution reverted" });
  assert.equal(describe(failed).hasDeltas, false);
  assert.equal(changesFrom([], ME).ok, false);
  assert.equal(changesFrom(undefined, ME).ok, false);
});

test("amounts: short, but tiny amounts still show", () => {
  assert.equal(amountText(1_234_567_890_000n, 6), "1,234,567.89");
  assert.equal(amountText(1n, 18), "0.000000000000000001");
  assert.equal(amountText(123_456_789_123_456_789n, 18), "0.123456");
  assert.equal(amountText(2n * 10n ** 18n, 18), "2");
});
