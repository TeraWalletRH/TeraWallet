import { test } from "node:test";
import assert from "node:assert/strict";

const APP_SHORTCUTS = [
  { id: "send", title: "Send Crypto", targetPage: "send" },
  { id: "swap", title: "Swap Tokens", targetPage: "swap" },
  { id: "scan", title: "Scan QR", targetPage: "scan" },
  { id: "activity", title: "Activity", targetPage: "activity" },
];

function resolveAppShortcut(shortcutId) {
  const item = APP_SHORTCUTS.find((s) => s.id === shortcutId);
  return item ? item.targetPage : null;
}

test("resolveAppShortcut maps quick action shortcut to page name", () => {
  assert.equal(resolveAppShortcut("send"), "send");
  assert.equal(resolveAppShortcut("swap"), "swap");
  assert.equal(resolveAppShortcut("scan"), "scan");
  assert.equal(resolveAppShortcut("activity"), "activity");
  assert.equal(resolveAppShortcut("unknown"), null);
});
