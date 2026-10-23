import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KNOWN_ADDRESSES, knownAddress, knownName, addressName, depositWarning, warningFor } from "../../public/tera/core/address-labels.js";
import { KNOWN_SPENDERS } from "../../public/tera/core/approvals.js";
import { filter } from "../../public/tera/core/activity-search.js";
const router = "0x8876789976decbfcbbbe364623c63652db8c0904";
test("built-in labels match only a complete address on the specified chain", () => {
  assert.equal(knownName(router), "Uniswap Universal Router");
  assert.equal(knownName(`0x${router.slice(2).toUpperCase()}`), "Uniswap Universal Router");
  for (const chain of [1, 8453, 46630, "4663", NaN]) assert.equal(knownAddress(router, chain), null);
  for (const value of [null, "", router.slice(0, -1), ` ${router}`, `${router}0`, `${router.slice(0, -1)}5`]) assert.equal(knownAddress(value), null);
});
test("every label has provenance in the existing integrations; spenders agree", () => {
  const unique = new Set();
  for (const entry of KNOWN_ADDRESSES) {
    assert.equal(unique.has(`${entry.chainId}:${entry.address}`), false);
    unique.add(`${entry.chainId}:${entry.address}`);
    assert.ok(entry.zh && entry.name);
    assert.ok(readFileSync(new URL(`../../${entry.source}`, import.meta.url), "utf8").toLowerCase().includes(entry.address));
    assert.ok(Object.isFrozen(entry));
  }
  for (const [address, names] of Object.entries(KNOWN_SPENDERS)) assert.equal(knownName(address), names[0]);
  assert.ok(Object.isFrozen(KNOWN_ADDRESSES));
});
test("contact names and built-in identities coexist and are searchable for incoming and outgoing activity", () => {
  const nameFor = address => addressName(address, { contact: "My swap app" });
  assert.equal(nameFor(router), "My swap app · Uniswap Universal Router");
  assert.equal(addressName(router, { language: "zh" }), "Uniswap 通用路由");
  const rows = [{ payee: router }, { counterpartyAddress: router, direction: "receive" }];
  for (const query of ["Uniswap", "My swap app", router]) assert.equal(filter(rows, { query }, { nameFor }).length, 2);
  assert.equal(knownName("0x1111111111111111111111111111111111111111"), "");
});
test("built-in labels warn about direct deposits without conferring contact trust", () => {
  assert.match(depositWarning(router), /does not execute a swap or bridge/);
  assert.match(depositWarning("0x5fc5360d0400a0fd4f2af552add042d716f1d168"), /token contract/);
  assert.equal(depositWarning(router, 1), "");
  assert.equal(warningFor({ category: "exchange" }).includes("Robinhood Chain support"), true);
  assert.equal(warningFor({ category: "exchange" }, "zh").includes("交易所"), true);
  // There are deliberately no guessed exchange/deposit addresses in the seed.
  assert.equal(KNOWN_ADDRESSES.some(row => row.category === "exchange"), false);
});
