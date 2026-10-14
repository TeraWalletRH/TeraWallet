import { test } from "node:test";
import assert from "node:assert/strict";
import { SHORTCUTS, isTyping, shortcutFor } from "../../public/tera/core/keyboard-shortcuts.js";

const body = { tagName: "BODY" };
const press = (key, extra = {}) => ({ key, target: body, ...extra });

test("S, R, /, ? and Esc", () => {
  assert.equal(shortcutFor(press("s")), "send");
  assert.equal(shortcutFor(press("r")), "receive");
  assert.equal(shortcutFor(press("/")), "search");
  assert.equal(shortcutFor(press("?", { shiftKey: true })), "help");
  assert.equal(shortcutFor(press("Escape")), "close");
  assert.equal(shortcutFor(press("x")), null);
  assert.equal(shortcutFor(press("Enter")), null);
});

test("capitals work, for caps lock and Shift", () => {
  assert.equal(shortcutFor(press("S")), "send");
  assert.equal(shortcutFor(press("R", { shiftKey: true })), "receive");
});

test("keys held with Cmd, Ctrl or Alt are the browser's", () => {
  assert.equal(shortcutFor(press("r", { metaKey: true })), null);
  assert.equal(shortcutFor(press("s", { ctrlKey: true })), null);
  assert.equal(shortcutFor(press("s", { altKey: true })), null);
  assert.equal(shortcutFor(press("/", { shiftKey: true })), null);
});

test("a held-down key fires once", () => {
  assert.equal(shortcutFor(press("s", { repeat: true })), null);
});

test("nothing while typing, Esc included", () => {
  for (const target of [
    { tagName: "INPUT" },
    { tagName: "INPUT", type: "search" },
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { tagName: "DIV", isContentEditable: true },
  ]) {
    assert.equal(isTyping(target), true);
    assert.equal(shortcutFor(press("s", { target })), null);
    assert.equal(shortcutFor(press("Escape", { target })), null);
  }
  assert.equal(isTyping({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTyping({ tagName: "BUTTON" }), false);
  assert.equal(isTyping(null), false);
});

test("nothing over a review, a PIN prompt or a shown secret, or under a dialog", () => {
  assert.equal(shortcutFor(press("s"), { blocked: true }), null);
  assert.equal(shortcutFor(press("Escape"), { blocked: true }), null);
  assert.equal(shortcutFor(press("r"), { dialogOpen: true }), null);
  // The dialog closes itself on Esc; the page under it must not also go back.
  assert.equal(shortcutFor(press("Escape"), { dialogOpen: true }), null);
});

test("the cheat sheet lists every key", () => {
  const actions = SHORTCUTS.map((s) => s.action);
  for (const action of ["send", "receive", "search", "help", "close", "palette"]) assert.ok(actions.includes(action));
  assert.equal(shortcutFor(null), null);
});
