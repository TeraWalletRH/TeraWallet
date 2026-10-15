import { test } from "node:test";
import assert from "node:assert/strict";
import { ERRORS } from "../../public/tera/core/dapp-connect.js";
import {
  needsConfirm,
  readMessage,
  refusal,
  signIn,
  signRequest,
} from "../../public/tera/core/dapp-sign.js";

const ME = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const site = { origin: "https://app.example", accounts: [ME] };
const hex = (text) => "0x" + Buffer.from(text, "utf8").toString("hex");

const permit = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Permit",
  domain: {
    name: "Global Dollar",
    chainId: 4663,
    verifyingContract: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  },
  message: { owner: ME, spender: OTHER, value: "1000000", nonce: 0, deadline: 1900000000 },
};
const tokens = { "0x5fc5360d0400a0fd4f2af552add042d716f1d168": { symbol: "USDG", decimals: 6 } };

test("hex messages are read as bytes; unreadable bytes are marked", () => {
  assert.deepEqual(readMessage("Hello"), { text: "Hello", sign: "Hello", readable: true });
  assert.deepEqual(readMessage(hex("Log in to Example")), {
    text: "Log in to Example",
    sign: { raw: hex("Log in to Example") },
    readable: true,
  });
  const binary = readMessage("0x" + "ab".repeat(32));
  assert.equal(binary.readable, false);
  assert.equal(binary.text, "0x" + "ab".repeat(32));
  assert.equal(readMessage("0x0001").readable, false, "control characters aren't text");
  assert.equal(readMessage(hex("line one\nline two")).readable, true);
});

test("a plain message is low risk and signed as written", () => {
  const r = signRequest("personal_sign", [hex("Welcome!"), ME], site);
  assert.equal(r.kind, "message");
  assert.equal(r.text, "Welcome!");
  assert.equal(r.danger, "low");
  assert.equal(needsConfirm(r), false);
});

test("[address, message] order is accepted too", () => {
  assert.equal(signRequest("personal_sign", [ME, "hi"], site).text, "hi");
});

test("only a connected site, for its own address", () => {
  assert.equal(
    signRequest("personal_sign", ["hi", ME], { origin: site.origin, accounts: [] }).error.code,
    ERRORS.unauthorized,
  );
  assert.equal(signRequest("personal_sign", ["hi", OTHER], site).error.code, ERRORS.unauthorized);
  assert.equal(
    signRequest("personal_sign", ["hi", ME.toLowerCase()], site).danger,
    "low",
    "address case doesn't matter",
  );
  assert.equal(
    signRequest("eth_signTypedData_v4", [OTHER, permit], site).error.code,
    ERRORS.unauthorized,
  );
});

test("unreadable data needs confirming", () => {
  const r = signRequest("personal_sign", ["0x" + "ab".repeat(32), ME], site);
  assert.equal(r.danger, "unknown");
  assert.equal(needsConfirm(r), true);
});

const siwe = (domain, address = ME, chain = 4663) =>
  `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nSign in.\n\nURI: https://${domain}\nVersion: 1\nChain ID: ${chain}\nNonce: abc12345\nIssued At: 2026-10-15T00:00:00Z`;

test("sign-in messages are recognised", () => {
  assert.deepEqual(signIn(siwe("app.example")), {
    domain: "app.example",
    address: ME,
    uri: "https://app.example",
    chainId: "4663",
  });
  assert.equal(signIn("Hello"), null);
});

test("a sign-in for the site asking is fine", () => {
  const r = signRequest("personal_sign", [siwe("app.example"), ME], site);
  assert.equal(r.title, "Sign in to app.example");
  assert.equal(r.danger, "low");
  assert.deepEqual(r.warnings, []);
});

test("a sign-in for another site is red", () => {
  const r = signRequest("personal_sign", [siwe("bank.example"), ME], site);
  assert.equal(r.danger, "high");
  assert.match(r.warnings[0], /for bank\.example, but the site asking is app\.example/);
  assert.equal(needsConfirm(r), true);
});

test("a sign-in for another address or chain is called out", () => {
  const r = signRequest("personal_sign", [siwe("app.example", OTHER, 1), ME], site);
  assert.equal(r.warnings.length, 2);
});

test("a permit is explained, red, and needs confirming", () => {
  const r = signRequest("eth_signTypedData_v4", [ME, JSON.stringify(permit)], { ...site, tokens });
  assert.equal(r.kind, "typed");
  assert.equal(r.danger, "high");
  assert.match(r.title, /spend 1 USDG/);
  assert.equal(needsConfirm(r), true);
  assert.equal(r.address, ME);
});

test("typed data for another chain is refused outright", () => {
  const other = { ...permit, domain: { ...permit.domain, chainId: 1 } };
  assert.equal(
    signRequest("eth_signTypedData_v4", [ME, other], site).error.code,
    ERRORS.invalidParams,
  );
  const hexChain = { ...permit, domain: { ...permit.domain, chainId: "0x1237" } };
  assert.equal(signRequest("eth_signTypedData_v4", [ME, hexChain], site).kind, "typed");
});

test("typed data must define its own type", () => {
  const broken = { ...permit, types: { EIP712Domain: permit.types.EIP712Domain } };
  assert.equal(
    signRequest("eth_signTypedData_v4", [ME, broken], site).error.code,
    ERRORS.invalidParams,
  );
  assert.equal(
    signRequest("eth_signTypedData_v4", [ME, "nope"], site).error.code,
    ERRORS.invalidParams,
  );
});

test("raw-hash signing and transactions are refused with reasons", () => {
  assert.match(refusal("eth_sign").message, /raw hashes/);
  assert.match(refusal("eth_sendTransaction").message, /transactions/);
  assert.equal(signRequest("eth_sign", [ME, "0x00"], site).error.code, ERRORS.unsupported);
});
