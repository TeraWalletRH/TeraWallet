import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, isPreset } from "../../public/tera/core/avatars.js";

test("PRESETS is a non-empty list of single emoji", () => {
  assert.ok(PRESETS.length > 0);
  for (const emoji of PRESETS) assert.equal(typeof emoji, "string");
  assert.equal(new Set(PRESETS).size, PRESETS.length);
});

test("isPreset accepts only values from PRESETS", () => {
  for (const emoji of PRESETS) assert.equal(isPreset(emoji), true);
  assert.equal(isPreset("🐍"), false);
  assert.equal(isPreset(""), false);
  assert.equal(isPreset(undefined), false);
  assert.equal(isPreset("not an emoji"), false);
});
