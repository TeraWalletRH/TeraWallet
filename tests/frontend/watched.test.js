import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  cleanWatched,
  sortedWatched,
  unwatch,
  watch,
  watchedFor,
} from "../../public/tera/core/watched.js";

const mine = `0x${"1".repeat(40)}`;
const second = `0x${"2".repeat(40)}`;
const cold = `0x${"A".repeat(40)}`;
const other = `0x${"b".repeat(40)}`;

test("an address is watched under a name, stored lowercase", () => {
  const result = watch([], { address: cold, name: "Cold storage", own: [mine], now: 5 });
  assert.ok(result.ok, result.reason);
  assert.deepEqual(result.entry, {
    address: cold.toLowerCase(),
    name: "Cold storage",
    tag: "",
    addedAt: 5,
  });
  assert.equal(watchedFor(result.list, cold)?.name, "Cold storage");
});

test("the owner's own wallets cannot be watched, so no money is shown twice", () => {
  for (const address of [mine, second, mine.toUpperCase().replace("0X", "0x")]) {
    const result = watch([], { address, name: "Mine", own: [mine, second] });
    assert.equal(result.ok, false);
    assert.match(result.reason, /your own wallets/);
  }
});

test("bad addresses and names are refused with a reason", () => {
  assert.match(watch([], { address: "0x123", name: "X" }).reason, /valid/);
  assert.match(watch([], { address: cold, name: "" }).reason, /Enter a name/);
  assert.match(watch([], { address: cold, name: "@whale" }).reason, /cannot start with @/);
  assert.match(
    watch([], { address: cold, name: "0xabcdef12" }).reason,
    /cannot contain an address/,
  );
});

test("two watched wallets cannot share a name; watching again renames", () => {
  let list = watch([], { address: cold, name: "Treasury", now: 1 }).list;
  const clash = watch(list, { address: other, name: " treasury " });
  assert.equal(clash.ok, false);
  assert.match(clash.reason, /already watch a wallet called "Treasury"/);
  const renamed = watch(list, { address: cold, name: "Company treasury", now: 9 });
  assert.ok(renamed.ok);
  assert.equal(renamed.list.length, 1);
  assert.equal(renamed.entry.addedAt, 1);
  list = unwatch(renamed.list, cold);
  assert.deepEqual(list, []);
  assert.deepEqual(unwatch(list, other), []);
});

test("the list is capped and cleaned on read", () => {
  let list = [];
  for (let i = 0; i < LIMITS.maxWatched; i += 1) {
    const address = `0x${i.toString(16).padStart(40, "c")}`;
    list = watch(list, { address, name: `Wallet ${i}` }).list;
  }
  assert.equal(list.length, LIMITS.maxWatched);
  const full = watch(list, { address: other, name: "One more" });
  assert.equal(full.ok, false);
  assert.match(full.reason, /up to 20/);
  assert.deepEqual(
    cleanWatched([
      { address: cold, name: "Ok", tag: "astra", addedAt: 3 },
      { address: cold, name: "Duplicate" },
      { address: "nope", name: "Bad" },
      { address: other, name: "" },
      { address: other, name: "Bad tag", tag: "Not A Tag!" },
      null,
    ]),
    [
      { address: cold.toLowerCase(), name: "Ok", tag: "astra", addedAt: 3 },
      { address: other, name: "Bad tag", tag: "", addedAt: 0 },
    ],
  );
  assert.deepEqual(
    sortedWatched([
      { address: cold, name: "Zed" },
      { address: other, name: "Alpha" },
    ]).map((entry) => entry.name),
    ["Alpha", "Zed"],
  );
});
