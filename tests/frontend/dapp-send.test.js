import { test } from "node:test";
import assert from "node:assert/strict";
import { ERRORS } from "../../public/tera/core/dapp-connect.js";
import {
  describe,
  feeCheck,
  formatEth,
  readTransaction,
} from "../../public/tera/core/dapp-send.js";

const ME = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const tokens = { [USDG]: { symbol: "USDG", decimals: 6 } };
const spenders = { [ROUTER]: "Tera swap router" };
const pad = (hex) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const call = (selector, ...words) => selector + words.map(pad).join("");
const tx = (over) => ({ from: ME, to: BOB, value: "0x0", data: "0x", ...over });

test("only a connected site, from its address, on Robinhood Chain", () => {
  assert.equal(readTransaction([{ to: BOB }], { accounts: [] }).error.code, ERRORS.unauthorized);
  assert.equal(
    readTransaction([{ from: BOB, to: BOB }], { accounts: [ME] }).error.code,
    ERRORS.unauthorized,
  );
  assert.equal(
    readTransaction([{ to: BOB, chainId: "0x1" }], { accounts: [ME] }).error.code,
    ERRORS.invalidParams,
  );
  assert.equal(readTransaction([{ to: BOB, chainId: "0x1237" }], { accounts: [ME] }).tx.to, BOB);
});

test("contract creation and malformed fields are refused", () => {
  assert.equal(
    readTransaction([{ data: "0x6080" }], { accounts: [ME] }).error.code,
    ERRORS.unsupported,
  );
  assert.equal(
    readTransaction([{ to: "0x12" }], { accounts: [ME] }).error.code,
    ERRORS.invalidParams,
  );
  assert.equal(
    readTransaction([{ to: BOB, value: "100" }], { accounts: [ME] }).error.code,
    ERRORS.invalidParams,
  );
  assert.equal(
    readTransaction([{ to: BOB, data: "0xabc" }], { accounts: [ME] }).error.code,
    ERRORS.invalidParams,
  );
  assert.equal(readTransaction([], { accounts: [ME] }).error.code, ERRORS.invalidParams);
});

test("the site's gas and fee suggestions are dropped; from defaults to the connected address", () => {
  const { tx: read } = readTransaction(
    [
      {
        to: BOB,
        value: "0x0de0b6b3a7640000",
        input: "0xABCD",
        gas: "0xffffff",
        maxFeePerGas: "0x1",
      },
    ],
    { accounts: [ME] },
  );
  assert.deepEqual(read, { from: ME, to: BOB, value: "0xde0b6b3a7640000", data: "0xabcd" });
});

test("ETH amounts read plainly", () => {
  assert.equal(formatEth(10n ** 18n), "1");
  assert.equal(formatEth(12_500_000_000_000_000n), "0.0125");
  assert.equal(formatEth(0n), "0");
  assert.equal(formatEth(1n), "<0.000001");
});

test("a plain ETH send is low risk", () => {
  const d = describe(tx({ value: "0x2c68af0bb140000" }));
  assert.equal(d.kind, "send");
  assert.equal(d.title, "Send 0.2 ETH");
  assert.equal(d.danger, "low");
});

test("a known token transfer is low risk and in its own units", () => {
  const d = describe(tx({ to: USDG, data: call("0xa9059cbb", BOB, 5_000_000n.toString(16)) }), {
    tokens,
  });
  assert.equal(d.title, "Send 5 USDG");
  assert.equal(d.danger, "low");
  const unknown = describe(tx({ data: call("0xa9059cbb", BOB, "64") }), { tokens });
  assert.equal(unknown.danger, "unknown");
});

test("approvals: unlimited or unknown spender is red, limited for a known contract is not", () => {
  const max = "f".repeat(64);
  const unlimited = describe(tx({ to: USDG, data: call("0x095ea7b3", ROUTER, max) }), {
    tokens,
    spenders,
  });
  assert.equal(unlimited.danger, "high");
  assert.equal(unlimited.title, "This lets Tera swap router spend all of your USDG");
  const limited = describe(
    tx({ to: USDG, data: call("0x095ea7b3", ROUTER, 1_000_000n.toString(16)) }),
    { tokens, spenders },
  );
  assert.equal(limited.danger, "low");
  assert.equal(limited.title, "This lets Tera swap router spend 1 USDG");
  const stranger = describe(tx({ to: USDG, data: call("0x095ea7b3", BOB, "1") }), {
    tokens,
    spenders,
  });
  assert.equal(stranger.danger, "high");
});

test("removing a permission is low risk", () => {
  const d = describe(tx({ to: USDG, data: call("0x095ea7b3", ROUTER, "0") }), { tokens, spenders });
  assert.equal(d.kind, "revoke");
  assert.equal(d.danger, "low");
  assert.equal(describe(tx({ data: call("0xa22cb465", BOB, "0") })).danger, "low");
});

test("approving a whole collection is red", () => {
  const d = describe(tx({ data: call("0xa22cb465", BOB, "1") }));
  assert.equal(d.kind, "approve-all");
  assert.equal(d.danger, "high");
});

test("any other call is unknown and shows the ETH it sends", () => {
  const d = describe(tx({ data: "0x12345678", value: "0xde0b6b3a7640000" }));
  assert.equal(d.danger, "unknown");
  assert.equal(d.title, "Send 1 ETH to a contract");
  assert.deepEqual(d.rows.at(-1), ["Also sends", "1 ETH"]);
});

test("a recipient that looks like someone paid before is called out", () => {
  const paid = ["0x1234567890abcdef1234567890abcdef1234abcd"];
  const d = describe(tx({ to: "0x123400000000000000000000000000000000abcd", value: "0x1" }), {
    paid,
  });
  assert.match(d.warnings[0], /Lookalike/);
  assert.deepEqual(describe(tx({ to: paid[0], value: "0x1" }), { paid }).warnings, []);
});

test("fees: capped at 0.001 ETH, and the wallet must cover amount plus fee", () => {
  assert.equal(
    feeCheck({ gas: 21000n, maxFeePerGas: 10n ** 9n, balance: 10n ** 18n, value: 0n }).error,
    undefined,
  );
  assert.match(
    feeCheck({ gas: 1_000_000n, maxFeePerGas: 2n * 10n ** 9n, balance: 10n ** 18n, value: 0n })
      .error,
    /0\.001 ETH limit/,
  );
  assert.match(
    feeCheck({ gas: 21000n, maxFeePerGas: 10n ** 9n, balance: 10n ** 15n, value: 10n ** 15n })
      .error,
    /Not enough ETH/,
  );
});
