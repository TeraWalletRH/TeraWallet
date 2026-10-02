import test from "node:test";
import assert from "node:assert/strict";
import { parseQrAddress } from "../../public/tera/wallet/checks.js";

test("parseQrAddress extracts EVM address from raw hex string", () => {
  const input = "0x9A6e20556c4d7f5AEE3a676E469C31E0Ac8bC4D9";
  const parsed = parseQrAddress(input);
  assert.equal(parsed, "0x9A6e20556c4d7f5aEE3a676E469c31E0ac8Bc4D9");
});

test("parseQrAddress extracts EVM address from EIP-681 ethereum: URI", () => {
  const uri = "ethereum:0x9A6e20556c4d7f5AEE3a676E469C31E0Ac8bC4D9?value=1e18";
  const parsed = parseQrAddress(uri);
  assert.equal(parsed, "0x9A6e20556c4d7f5aEE3a676E469c31E0ac8Bc4D9");
});

test("parseQrAddress returns null for invalid input", () => {
  assert.equal(parseQrAddress("invalid_string"), null);
  assert.equal(parseQrAddress(""), null);
  assert.equal(parseQrAddress(null), null);
});
