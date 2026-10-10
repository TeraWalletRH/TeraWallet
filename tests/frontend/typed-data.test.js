import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMIT2, explain, formatAmount, parseRequest } from "../../public/tera/core/typed-data.js";

const usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const owner = `0x${"1".repeat(40)}`;
const router = "0xcaf681a66d020601342297493863e78c959e5cb2";
const stranger = `0x${"9".repeat(40)}`;
const MAX = (2n ** 256n - 1n).toString();
const NOW = 1_800_000_000;
const ctx = {
  chainId: 4663,
  owner,
  now: NOW,
  tokens: { [usdg]: { symbol: "USDG", decimals: 6 } },
  spenders: { [router]: "Tera swap router" },
};
const permit = (message, domain = {}) => ({
  domain: { name: "USDG", version: "1", chainId: 4663, verifyingContract: usdg, ...domain },
  primaryType: "Permit",
  types: {},
  message: { owner, nonce: 0, ...message },
});

test("pasted JSON, a v4 request and its params all parse", () => {
  const typed = permit({ spender: router, value: "1", deadline: NOW + 60 });
  assert.equal(parseRequest(JSON.stringify(typed)).typed.primaryType, "Permit");
  const request = { method: "eth_signTypedData_v4", params: [owner, JSON.stringify(typed)] };
  const parsed = parseRequest(JSON.stringify(request));
  assert.equal(parsed.typed.domain.name, "USDG");
  assert.equal(parsed.signer, owner);
  assert.equal(parseRequest([typed, owner]).signer, owner);
  assert.throws(() => parseRequest("hello"), /isn't a signature request/);
  assert.throws(() => parseRequest({ foo: 1 }), /isn't a signature request/);
});

test("amounts read in tokens, and huge ones as unlimited", () => {
  assert.equal(formatAmount("1500000", usdg, ctx.tokens), "1.5 USDG");
  assert.equal(formatAmount("1000000000", usdg, ctx.tokens), "1,000 USDG");
  assert.equal(formatAmount(MAX, usdg, ctx.tokens), "Unlimited USDG");
  assert.match(formatAmount("5", stranger), /^5 base units of 0x9999…9999$/);
});

test("an ERC-2612 permit is red and says who can spend what", () => {
  const out = explain(permit({ spender: router, value: "25000000", deadline: NOW + 3600 }), ctx);
  assert.equal(out.danger, "high");
  assert.equal(out.title, "This lets Tera swap router spend 25 USDG from your wallet");
  assert.deepEqual(out.warnings, []);
});

test("an unlimited permit to an unknown spender that never expires collects every warning", () => {
  const out = explain(permit({ spender: stranger, value: MAX, deadline: MAX }), ctx);
  assert.equal(out.danger, "high");
  assert.match(out.title, /spend Unlimited USDG/);
  assert.equal(out.warnings.length, 2);
  assert.match(out.warnings.join(" "), /not a contract Tera knows/);
  assert.match(out.warnings.join(" "), /more than a year, or never expires/);
});

test("a DAI-style permit with allowed=true is unlimited; allowed=false removes it", () => {
  const dai = (allowed) => ({
    domain: { name: "Dai", chainId: 4663, verifyingContract: usdg },
    primaryType: "Permit",
    message: { holder: owner, spender: router, nonce: 0, expiry: NOW + 60, allowed },
  });
  assert.equal(explain(dai(true), ctx).danger, "high");
  assert.match(explain(dai(true), ctx).title, /all of your USDG/);
  assert.equal(explain(dai(false), ctx).danger, "low");
});

test("Permit2 allowances and transfers are red, and transfers say 'immediately'", () => {
  const single = {
    domain: { name: "Permit2", chainId: 4663, verifyingContract: PERMIT2 },
    primaryType: "PermitSingle",
    message: { details: { token: usdg, amount: MAX, expiration: NOW + 30 * 86400, nonce: 0 }, spender: router, sigDeadline: NOW + 600 },
  };
  const a = explain(single, ctx);
  assert.equal(a.kind, "permit2");
  assert.equal(a.danger, "high");
  assert.match(a.title, /Unlimited USDG through Permit2/);
  const transfer = {
    domain: { name: "Permit2", chainId: 4663, verifyingContract: PERMIT2 },
    primaryType: "PermitTransferFrom",
    message: { permitted: { token: usdg, amount: "2000000" }, spender: stranger, nonce: 1, deadline: NOW + 60 },
  };
  const b = explain(transfer, ctx);
  assert.equal(b.kind, "permit2-transfer");
  assert.match(b.title, /take 2 USDG from your wallet immediately/);
});

test("a Permit2-shaped message addressed elsewhere is called an imitation", () => {
  const fake = {
    domain: { name: "Permit2", chainId: 4663, verifyingContract: stranger },
    primaryType: "PermitSingle",
    message: { details: { token: usdg, amount: "1", expiration: NOW + 60, nonce: 0 }, spender: router, sigDeadline: NOW + 60 },
  };
  assert.match(explain(fake, ctx).warnings.join(" "), /imitation/);
});

test("another chain and another owner are called out", () => {
  const out = explain(permit({ owner: stranger, spender: router, value: "1", deadline: NOW + 60 }, { chainId: 1 }), ctx);
  assert.match(out.warnings.join(" "), /chain 1, not Robinhood Chain/);
  assert.match(out.warnings.join(" "), /not this wallet/);
});

test("a marketplace order is red", () => {
  const order = {
    domain: { name: "Seaport", chainId: 4663, verifyingContract: stranger },
    primaryType: "OrderComponents",
    message: { offerer: owner, offer: [{ token: stranger }], consideration: [], endTime: NOW + 60 },
  };
  const out = explain(order, ctx);
  assert.equal(out.kind, "order");
  assert.equal(out.danger, "high");
});

test("anything unrecognised is unknown, never safe, and shows its fields", () => {
  const login = {
    domain: { name: "Some Game", chainId: 4663 },
    primaryType: "Login",
    message: { wallet: owner, nonce: "abc", note: { text: "hi" } },
  };
  const out = explain(login, ctx);
  assert.equal(out.danger, "unknown");
  assert.ok(out.rows.some(([label]) => label === "note.text"));
  assert.match(out.warnings.at(-1), /doesn't recognise/);
});
