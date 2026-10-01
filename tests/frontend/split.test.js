import { test } from "node:test";
import assert from "node:assert/strict";
import { check, cleanSplits, cleanText, progress, requestNote, splitEvenly } from "../../public/tera/core/split.js";

const $ = (dollars) => BigInt(Math.round(dollars * 1_000_000));

test("an even split always adds up, leftover cents going to the first people", () => {
  assert.deepEqual(splitEvenly($(120), 4), { shares: [$(30), $(30), $(30), $(30)], mine: 0n });
  const odd = splitEvenly(100n, 3);
  assert.deepEqual(odd.shares, [34n, 33n, 33n]);
  assert.equal(odd.shares.reduce((a, b) => a + b, 0n), 100n);
  // With the owner in, they are one more share and are not asked for it.
  const withMe = splitEvenly($(100), 3, true);
  assert.deepEqual(withMe.shares, [$(25), $(25), $(25)]);
  assert.equal(withMe.mine, $(25));
  const awkward = splitEvenly(10n, 3, true);
  assert.equal(awkward.shares.reduce((a, b) => a + b, 0n) + awkward.mine, 10n);
  assert.deepEqual(splitEvenly($(10), 0), { shares: [], mine: 0n });
});

test("a split is checked before any request is made", () => {
  const ok = { title: "Dinner", total: $(90), names: ["Ada", "Ben"], shares: [$(45), $(45)] };
  assert.deepEqual(check(ok), { ok: true, mine: 0n });
  assert.equal(check({ ...ok, title: " " }).reason, "title");
  assert.equal(check({ ...ok, total: 0n }).reason, "total");
  assert.equal(check({ ...ok, names: [], shares: [] }).reason, "people");
  assert.equal(check({ ...ok, names: ["Ada", "ada "] }).reason, "same-name");
  assert.equal(check({ ...ok, shares: [$(45), 0n] }).reason, "share");
  assert.equal(check({ ...ok, shares: [$(50), $(45)] }).reason, "over");
  const short = check({ ...ok, shares: [$(40), $(45)] });
  assert.equal(short.reason, "short");
  assert.equal(short.missing, $(5));
  // With the owner in, the rest is theirs.
  assert.deepEqual(check({ ...ok, shares: [$(30), $(30)], includeMe: true }), { ok: true, mine: $(30) });
});

test("names and titles are cleaned; a request says whose share it is", () => {
  assert.equal(cleanText("  Ada​  L. ", 40), "Ada L.");
  assert.equal(cleanText("x".repeat(80), 40).length, 40);
  assert.equal(requestNote("Dinner at Nobu", "Ada"), "Dinner at Nobu · Ada's share");
});

test("progress counts what each link says, and money only once paid", () => {
  const split = {
    shares: [
      { name: "Ada", amount: String($(30)), linkId: "a" },
      { name: "Ben", amount: String($(30)), linkId: "b" },
      { name: "Cy", amount: String($(30)), linkId: "c" },
    ],
  };
  assert.deepEqual(progress(split, { a: "paid", c: "cancelled" }), {
    paid: 1,
    open: 1,
    cancelled: 1,
    collected: $(30),
    owed: $(30),
  });
  assert.equal(progress(split).open, 3);
});

test("stored splits are kept only when well formed, newest first", () => {
  const list = cleanSplits([
    { id: "1", createdAt: 1, shares: [{ linkId: "a", amount: "5" }] },
    { id: "2", createdAt: 2, shares: [{ linkId: "b", amount: "x" }] },
    { id: "3", createdAt: 3, shares: [] },
    null,
  ]);
  assert.deepEqual(
    list.map((s) => s.id),
    ["3", "1"],
  );
});
