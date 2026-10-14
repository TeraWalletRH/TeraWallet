import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TOTAL, SIZES, current, next, scaleFor, scaleStyle, systemAllowance } from "../../public/tera/core/text-size.js";

test("three sizes; unknown or missing is Default", () => {
  assert.deepEqual(SIZES.map((s) => s.id), ["default", "large", "larger"]);
  assert.equal(scaleFor("large"), 1.15);
  assert.equal(scaleFor("larger"), 1.3);
  assert.equal(scaleFor(undefined), 1);
  assert.equal(scaleFor("huge"), 1);
  assert.equal(current("huge"), "default");
  assert.equal(current("larger"), "larger");
});

test("font size and line height scale to whole pixels", () => {
  assert.deepEqual(scaleStyle({ fontSize: 15, lineHeight: 22, color: "red" }, 1.3), { fontSize: 20, lineHeight: 29 });
  assert.deepEqual(scaleStyle({ fontSize: 17 }, 1.15), { fontSize: 20 });
});

test("nothing to change at Default, or when the style sets no size", () => {
  assert.equal(scaleStyle({ fontSize: 15 }, 1), null);
  assert.equal(scaleStyle({ color: "red" }, 1.3), null);
  assert.equal(scaleStyle(null, 1.3), null);
});

test("the system's text size stacks on top, up to twice the design size", () => {
  assert.equal(systemAllowance(1), MAX_TOTAL);
  assert.ok(Math.abs(1.3 * systemAllowance(1.3) - MAX_TOTAL) < 1e-9);
  assert.equal(systemAllowance(3), 1);
});

test("Settings steps through the sizes", () => {
  assert.equal(next("default"), "large");
  assert.equal(next("large"), "larger");
  assert.equal(next("larger"), "default");
  assert.equal(next(undefined), "large");
});
