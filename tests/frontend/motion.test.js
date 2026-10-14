import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, duration, modalAnimation, reduced, spinnerTurn, toggled } from "../../public/tera/core/motion.js";

test("follows the device until the owner chooses", () => {
  assert.equal(reduced(true, undefined), true);
  assert.equal(reduced(false, undefined), false);
  assert.equal(reduced(undefined, undefined), false);
});

test("an explicit choice in Settings wins either way", () => {
  assert.equal(reduced(false, true), true);
  assert.equal(reduced(true, false), false);
});

test("dialogs appear without sliding or fading; transitions take no time", () => {
  assert.equal(modalAnimation("slide", true), "none");
  assert.equal(modalAnimation("fade", false), "fade");
  assert.equal(duration(260, true), 0);
  assert.equal(duration(260, false), 260);
});

test("a spinner slows down but never stops", () => {
  assert.equal(spinnerTurn(1100, false), 1100);
  assert.equal(spinnerTurn(1100, true), 3300);
});

test("Settings says where the choice comes from", () => {
  assert.equal(describe(true, undefined), "device-on");
  assert.equal(describe(false, undefined), "device-off");
  assert.equal(describe(true, false), "off");
  assert.equal(describe(false, true), "on");
});

test("the toggle flips what is in force, and matching the device follows it again", () => {
  assert.equal(toggled(false, undefined), true);
  assert.equal(toggled(true, undefined), false);
  assert.equal(toggled(false, true), undefined);
  assert.equal(toggled(true, false), undefined);
});
