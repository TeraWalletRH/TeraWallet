import { test } from "node:test";
import assert from "node:assert/strict";
import { explainRevert, revertData } from "../../public/tera/core/revert.js";

// What viem threw for the empty-wallet USDG payment, shaped as viem shapes it.
const usdgEmpty = {
  shortMessage: "Execution reverted for an unknown reason.",
  details: "execution reverted",
  message:
    "Execution reverted for an unknown reason.\n\nRaw Call Arguments:\n  from:   0xFB4cd5A82f69dEf5589D532247C2138c42E57232\n  to:     0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  cause: { data: "0x356680b7", message: "execution reverted" },
};
const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const errorString = (text) => {
  const hex = Buffer.from(text, "utf8").toString("hex");
  return `0x08c379a0${word(32)}${word(hex.length / 2)}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`;
};

test("an empty USDG wallet is said in words, not 'unknown reason'", () => {
  assert.equal(revertData(usdgEmpty), "0x356680b7");
  assert.equal(
    explainRevert(usdgEmpty, { symbol: "USDG" }),
    "This wallet doesn't have enough USDG for this. Nothing was sent.",
  );
  // The node's own wording carries the code too.
  assert.match(
    explainRevert('execution reverted, data: "0x356680b7"', { symbol: "USDG" }),
    /doesn't have enough USDG/,
  );
});

test("the common refusals are named", () => {
  const erc20 = `0xe450d38c${word("0xfb4cd5a82f69def5589d532247c2138c42e57232")}${word(0)}${word(2_000_000)}`;
  assert.match(
    explainRevert({ cause: { data: erc20 } }, { symbol: "USDG" }),
    /doesn't have enough USDG/,
  );
  assert.match(
    explainRevert({ data: "0x13be252b" }, { symbol: "WETH" }),
    /WETH hasn't been approved/,
  );
  assert.match(explainRevert({ data: "0xd93c0665" }, { symbol: "USDG" }), /paused by its issuer/);
  assert.match(
    explainRevert({ data: "0x1fd1cc44" }, { symbol: "USDG" }),
    /frozen one of these addresses/,
  );
  assert.match(explainRevert({ data: "0x356680b7" }), /enough of this token/);
});

test("a token's own message is shown, after the usual 'not enough' check", () => {
  assert.match(
    explainRevert(
      { data: errorString("ERC20: transfer amount exceeds balance") },
      { symbol: "TERA" },
    ),
    /doesn't have enough TERA/,
  );
  assert.equal(
    explainRevert({ data: errorString("Recipient is blocked") }),
    'The transaction was refused: "Recipient is blocked". Nothing was sent.',
  );
  assert.match(explainRevert({ data: `0x4e487b71${word(0x11)}` }), /internal error \(code 17\)/);
});

test("an unrecognised code is named, and no code means no explanation", () => {
  assert.equal(
    explainRevert({ data: "0xdeadbeef" }),
    "The transaction was refused by the contract (error 0xdeadbeef). Nothing was sent.",
  );
  // An address or hash in a message isn't revert data.
  assert.equal(
    explainRevert(new Error("nonce too low for 0x5fc5360d0400a0fd4f2af552add042d716f1d168")),
    null,
  );
  assert.equal(explainRevert(new Error("fetch failed")), null);
  // A code after an address in the same message is still found.
  assert.match(
    explainRevert("from 0x5fc5360d0400a0fd4f2af552add042d716f1d168 reverted with 0x356680b7", {
      symbol: "USDG",
    }),
    /enough USDG/,
  );
  assert.equal(explainRevert(null), null);
});
