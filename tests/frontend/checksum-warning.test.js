import test from "node:test";
import assert from "node:assert/strict";
import { checkAddressChecksum } from "../../public/tera/wallet/checks.js";

test("checkAddressChecksum > identifies checksummed EVM address", () => {
  const checksummed = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
  const res = checkAddressChecksum(checksummed);
  assert.equal(res.validAddress, true);
  assert.equal(res.isChecksummed, true);
  assert.equal(res.checksummedAddress, checksummed);
});

test("checkAddressChecksum > detects non-checksummed lowercase address and provides 1-click checksummed address", () => {
  const lowercase = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f";
  const expected = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
  const res = checkAddressChecksum(lowercase);
  assert.equal(res.validAddress, true);
  assert.equal(res.isChecksummed, false);
  assert.equal(res.checksummedAddress, expected);
});

test("checkAddressChecksum > flags invalid address strings", () => {
  assert.equal(checkAddressChecksum("not-an-address").validAddress, false);
  assert.equal(checkAddressChecksum("0x123").validAddress, false);
  assert.equal(checkAddressChecksum(null).validAddress, false);
});
