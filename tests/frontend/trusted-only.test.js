import { test } from "node:test";
import assert from "node:assert/strict";

function isRecipientTrusted(recipient, contacts, trustedOnlyMode) {
  if (!trustedOnlyMode) return true;
  if (!recipient || typeof recipient !== "string") return false;
  if (!Array.isArray(contacts)) return false;
  return contacts.some(
    (c) => typeof c.address === "string" && c.address.toLowerCase() === recipient.toLowerCase(),
  );
}

test("trusted-only mode allows saved contact recipient", () => {
  const alice = "0x1111111111111111111111111111111111111111";
  const contacts = [{ address: alice, name: "Alice" }];

  assert.equal(isRecipientTrusted(alice, contacts, true), true);
});

test("trusted-only mode blocks unsaved recipient", () => {
  const bob = "0x2222222222222222222222222222222222222222";
  const contacts = [{ address: "0x1111111111111111111111111111111111111111", name: "Alice" }];

  assert.equal(isRecipientTrusted(bob, contacts, true), false);
});

test("trusted-only mode disabled allows any recipient", () => {
  const bob = "0x2222222222222222222222222222222222222222";
  assert.equal(isRecipientTrusted(bob, [], false), true);
});
