import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  ROBINHOOD_CHAIN_ID,
  addNetwork,
  cleanNetworks,
  removeNetwork,
  sortedNetworks,
} from "../../public/tera/core/networks.js";

const BASE = {
  chainId: 8453,
  name: "Base",
  rpcUrl: "https://mainnet.base.org",
  symbol: "eth",
};

test("a well-formed network is added, symbol folded to uppercase", () => {
  const result = addNetwork([], { ...BASE, now: 5 });
  assert.ok(result.ok, result.reason);
  assert.deepEqual(result.entry, {
    chainId: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    symbol: "ETH",
    explorerUrl: "",
    addedAt: 5,
  });
});

test("refuses Robinhood Chain's own chain ID", () => {
  const result = addNetwork([], { ...BASE, chainId: ROBINHOOD_CHAIN_ID });
  assert.equal(result.ok, false);
  assert.match(result.reason, /already has this network/);
});

test("refuses a bad chain ID, name, RPC URL, symbol or explorer", () => {
  assert.match(addNetwork([], { ...BASE, chainId: 0 }).reason, /valid chain ID/);
  assert.match(addNetwork([], { ...BASE, chainId: "x" }).reason, /valid chain ID/);
  assert.match(addNetwork([], { ...BASE, name: "" }).reason, /Enter a name/);
  assert.match(addNetwork([], { ...BASE, rpcUrl: "http://mainnet.base.org" }).reason, /https:\/\//);
  assert.match(addNetwork([], { ...BASE, rpcUrl: "not a url" }).reason, /https:\/\//);
  assert.match(addNetwork([], { ...BASE, symbol: "way too long" }).reason, /1-10 letters/);
  assert.match(
    addNetwork([], { ...BASE, explorerUrl: "http://basescan.org" }).reason,
    /explorer URL must be https/,
  );
});

test("adding again at the same chain ID updates it in place", () => {
  const first = addNetwork([], { ...BASE, now: 1 }).list;
  const second = addNetwork(first, { ...BASE, name: "Base mainnet", now: 9 });
  assert.ok(second.ok);
  assert.equal(second.list.length, 1);
  assert.equal(second.entry.name, "Base mainnet");
  // Original add time kept, not the update's.
  assert.equal(second.entry.addedAt, 1);
});

test("stops at the maximum and removing is never an error", () => {
  let list = [];
  for (let i = 0; i < LIMITS.maxNetworks; i++) {
    list = addNetwork(list, { ...BASE, chainId: 10000 + i }).list;
  }
  const overflow = addNetwork(list, { ...BASE, chainId: 99999 });
  assert.equal(overflow.ok, false);
  assert.match(overflow.reason, /up to 20 networks/);

  list = removeNetwork(list, 10000);
  assert.equal(list.length, LIMITS.maxNetworks - 1);
  assert.deepEqual(removeNetwork(list, 424242), list);
});

test("cleanNetworks drops malformed entries and sortedNetworks sorts by name", () => {
  const dirty = [
    { chainId: 1, name: "Bad RPC", rpcUrl: "ftp://x", symbol: "X" },
    { chainId: ROBINHOOD_CHAIN_ID, name: "Impersonating Robinhood", rpcUrl: "https://x.com", symbol: "X" },
    { chainId: 137, name: "Polygon", rpcUrl: "https://polygon-rpc.com", symbol: "MATIC" },
    { chainId: 42161, name: "Arbitrum", rpcUrl: "https://arb1.arbitrum.io/rpc", symbol: "ETH" },
  ];
  assert.deepEqual(cleanNetworks(dirty).map((e) => e.chainId), [137, 42161]);
  assert.deepEqual(sortedNetworks(dirty).map((e) => e.name), ["Arbitrum", "Polygon"]);
});
