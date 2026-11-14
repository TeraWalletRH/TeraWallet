// src/stay.ts: what's kept while Tera stays unlocked, and when it's dropped.
import { expect, it } from "bun:test";
import { drop, heldSecret, hold, isStay, shorten, stayLabel } from "../src/stay";

const A = "0xAbC0000000000000000000000000000000000001";
const B = "0xdef0000000000000000000000000000000000002";
const MIN = 60_000;

it("keeps nothing when set to ask every time", () => {
  expect(hold(null, A, "secret", 0, 0)).toBeNull();
  expect(hold(null, A, "secret", 7, 0)).toBeNull();
  expect(isStay(15)).toBe(true);
  expect(isStay("15")).toBe(false);
  expect(stayLabel(0)).toBe("Every time");
  expect(stayLabel(60)).toBe("1 hour");
});

it("gives the secret back until the time is up, by any spelling of the address", () => {
  const held = hold(null, A, "secret", 5, 1000);
  expect(heldSecret(held, A.toLowerCase(), 1000 + 5 * MIN - 1)).toBe("secret");
  expect(heldSecret(held, A, 1000 + 5 * MIN)).toBeNull();
  expect(heldSecret(held, B, 1000)).toBeNull();
});

it("a second wallet joins the first, on the new clock", () => {
  const first = hold(null, A, "a", 5, 0);
  const both = hold(first, B, "b", 15, 4 * MIN);
  expect(heldSecret(both, A, 18 * MIN)).toBe("a");
  expect(heldSecret(both, B, 18 * MIN)).toBe("b");
  // An expired hold isn't carried into a new one.
  const later = hold(first, B, "b", 5, 6 * MIN);
  expect(heldSecret(later, A, 6 * MIN)).toBeNull();
});

it("a shorter setting brings the end forward, never back", () => {
  const held = hold(null, A, "a", 60, 0);
  expect(shorten(held, 5, 10 * MIN)?.until).toBe(15 * MIN);
  expect(shorten(hold(null, A, "a", 5, 0), 60, MIN)?.until).toBe(5 * MIN);
  expect(shorten(held, 0, MIN)).toBeNull();
});

it("forgets a removed wallet", () => {
  const both = hold(hold(null, A, "a", 5, 0), B, "b", 5, 0);
  expect(heldSecret(drop(both, A, 0), B, 0)).toBe("b");
  expect(heldSecret(drop(both, A, 0), A, 0)).toBeNull();
  expect(drop(hold(null, A, "a", 5, 0), A, 0)).toBeNull();
});
