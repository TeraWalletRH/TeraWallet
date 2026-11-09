import { describe, expect, test } from "bun:test";
import { isAddress } from "viem";
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

  test("a Solana destination can never pass trusted-only, no matter the contact book", () => {
    // Bridge supports an external Solana recipient (base58, not 0x…), but
    // the contact book only ever stores EVM addresses, so there is no
    // contacts list that could ever make this true -- the Bridge call sites
    // must show a message that says so, not the normal "save it as a
    // contact" copy, since that fix doesn't exist for this address shape.
    const solanaAddress = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
    expect(isAddress(solanaAddress)).toBe(false);
    expect(isTrustedRecipient(solanaAddress, contacts)).toBe(false);
    expect(isTrustedRecipient(solanaAddress, [{ address: solanaAddress }])).toBe(false);
  });
});
