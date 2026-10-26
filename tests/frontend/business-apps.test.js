import { test } from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_APPS } from "../../public/tera/core/business-apps.js";
import { DAPPS } from "../../public/tera/core/dapp-directory.js";

test("every entry is well-formed: unique id, https url, non-empty fields", () => {
  assert.ok(BUSINESS_APPS.length > 0);
  const seen = new Set();
  for (const entry of BUSINESS_APPS) {
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

test("does not duplicate the general discovery list's entries", () => {
  const generalIds = new Set(DAPPS.map((entry) => entry.id));
  for (const entry of BUSINESS_APPS) assert.ok(!generalIds.has(entry.id), entry.id);
});
