import { describe, expect, test } from "bun:test";
import { isTrustedRecipient } from "../src/validation";

describe("trusted-only mode validation", () => {
  const alice = "0x1111111111111111111111111111111111111111";
  const bob = "0x2222222222222222222222222222222222222222";
  const charlie = "0x3333333333333333333333333333333333333333";

  const contacts = [
    { address: alice, name: "Alice", savedAt: Date.now() },
    { address: bob, name: "Bob", savedAt: Date.now() },
  ];

  test("returns true for recipient saved in contacts", () => {
    expect(isTrustedRecipient(alice, contacts)).toBe(true);
    expect(isTrustedRecipient(bob.toUpperCase(), contacts)).toBe(true);
  });

  test("returns false for unsaved recipient", () => {
    expect(isTrustedRecipient(charlie, contacts)).toBe(false);
  });

  test("returns false when contacts list is empty or undefined", () => {
    expect(isTrustedRecipient(alice, [])).toBe(false);
    expect(isTrustedRecipient(alice, undefined)).toBe(false);
  });

  test("returns false for invalid address", () => {
    expect(isTrustedRecipient("not-an-address", contacts)).toBe(false);
  });
});
