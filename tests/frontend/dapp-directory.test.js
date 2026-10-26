import { test } from "node:test";
import assert from "node:assert/strict";
import { byCategory, CATEGORIES, DAPPS } from "../../public/tera/core/dapp-directory.js";

test("every entry is well-formed: unique id, https url, non-empty fields", () => {
  assert.ok(DAPPS.length > 0);
  const seen = new Set();
  for (const entry of DAPPS) {
    assert.equal(typeof entry.id, "string");
    assert.ok(!seen.has(entry.id), `duplicate id ${entry.id}`);
    seen.add(entry.id);
    assert.ok(entry.name);
    assert.ok(entry.category);
    assert.ok(entry.description);
    assert.match(entry.url, /^https:\/\//);
    assert.doesNotThrow(() => new URL(entry.url));
  }
});

test("CATEGORIES lists every distinct category exactly once", () => {
  const fromEntries = new Set(DAPPS.map((entry) => entry.category));
  assert.equal(CATEGORIES.length, fromEntries.size);
  for (const category of CATEGORIES) assert.ok(fromEntries.has(category));
});

test("byCategory filters correctly, and returns everything for a falsy category", () => {
  const category = CATEGORIES[0];
  const filtered = byCategory(category);
  assert.ok(filtered.length > 0);
  for (const entry of filtered) assert.equal(entry.category, category);
  assert.deepEqual(byCategory(""), DAPPS);
  assert.deepEqual(byCategory(undefined), DAPPS);
});
