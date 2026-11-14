import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ADDED,
  addToken,
  checkToken,
  cleanAdded,
  decodeAbiString,
  decodeDecimals,
  readWatchAsset,
  removeToken,
} from "../../public/tera/core/token-add.js";
import { ERRORS, classify } from "../../public/tera/core/dapp-connect.js";

const TOKEN = "0x1111111111111111111111111111111111111111";
const USDG = { symbol: "USDG", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6 };
const word = (n) => n.toString(16).padStart(64, "0");
const abiString = (text) => {
  const bytes = Buffer.from(text, "utf8");
  return "0x" + word(32) + word(bytes.length) + bytes.toString("hex").padEnd(64, "0");
};

test("wallet_watchAsset is the wallet's own method", () => {
  assert.equal(classify("wallet_watchAsset"), "asset");
});

test("reads an ERC-20 request, as an object or the first of an array", () => {
  const request = {
    type: "ERC20",
    options: { address: TOKEN.toUpperCase().replace("0X", "0x"), symbol: "GOLD", decimals: "18" },
  };
  assert.deepEqual(readWatchAsset(request).token, { address: TOKEN, symbol: "GOLD", decimals: 18 });
  assert.deepEqual(readWatchAsset([request]).token, readWatchAsset(request).token);
});

test("refuses what isn't an ERC-20 token", () => {
  const bad = (options, type = "ERC20") => readWatchAsset({ type, options }).error;
  assert.equal(
    bad({ address: TOKEN, symbol: "A", decimals: 0 }, "ERC721").code,
    ERRORS.invalidParams,
  );
  assert.ok(bad({ address: "0x1234", symbol: "A", decimals: 0 }));
  assert.ok(bad({ address: "0x" + "0".repeat(40), symbol: "A", decimals: 0 }));
  assert.ok(bad({ address: TOKEN, symbol: "<script>", decimals: 0 }));
  assert.ok(bad({ address: TOKEN, symbol: "A", decimals: 37 }));
  assert.ok(bad({ address: TOKEN, symbol: "A", decimals: 1.5 }));
  assert.ok(bad({ address: TOKEN, symbol: "A" }));
  assert.ok(readWatchAsset(null).error);
});

test("decodes a token's own answers", () => {
  assert.equal(decodeAbiString(abiString("Gold Token")), "Gold Token");
  assert.equal(decodeAbiString("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0")), "MKR");
  assert.equal(decodeAbiString("0x"), null);
  assert.equal(decodeAbiString("0x" + word(32) + word(999)), null);
  assert.equal(decodeDecimals("0x" + word(18)), 18);
  assert.equal(decodeDecimals("0x" + word(2 ** 40)), null);
  assert.equal(decodeDecimals("0x"), null);
});

test("keeps the token's own name, and warns when the site's differs", () => {
  const token = { address: TOKEN, symbol: "GLD", decimals: 18 };
  const checked = checkToken({
    token,
    onChain: { symbol: "GOLD", name: "Gold", decimals: 18 },
    listed: [USDG],
  });
  assert.deepEqual(checked.asset, { address: TOKEN, symbol: "GOLD", name: "Gold", decimals: 18 });
  assert.match(checked.warnings[0], /called it GLD, but the token calls itself GOLD/);
  assert.match(checked.warnings.at(-1), /Tera doesn't know this token/);
});

test("refuses non-tokens, wrong decimals and lookalikes", () => {
  const token = { address: TOKEN, symbol: "USDG", decimals: 6 };
  assert.match(
    checkToken({ token, onChain: { symbol: null, decimals: null } }).error.message,
    /doesn't answer like a token/,
  );
  assert.match(
    checkToken({ token, onChain: { symbol: "X", decimals: 18 } }).error.message,
    /says 18/,
  );
  const twin = checkToken({ token, onChain: { symbol: "usdg", decimals: 6 }, listed: [USDG] });
  assert.match(twin.error.message, /already lists USDG/);
  assert.match(
    checkToken({ token, onChain: { symbol: "US DG", decimals: 6 } }).error.message,
    /characters/,
  );
});

test("the added list keeps each token once, and has a limit", () => {
  const gold = { address: TOKEN, symbol: "GOLD", name: "Gold", decimals: 18 };
  let list = addToken([], gold);
  list = addToken(list, { ...gold, address: TOKEN.toUpperCase().replace("0X", "0x") });
  assert.equal(list.length, 1);
  assert.equal(list[0].added, true);
  assert.deepEqual(removeToken(list, TOKEN), []);
  assert.deepEqual(cleanAdded([{ address: "nope" }, null, gold]).length, 1);
  const full = Array.from({ length: MAX_ADDED }, (_, i) => ({
    ...gold,
    address: "0x" + (i + 1).toString(16).padStart(40, "0"),
  }));
  assert.throws(() => addToken(full, { ...gold, address: "0x" + "f".repeat(40) }), /up to 50/);
});
