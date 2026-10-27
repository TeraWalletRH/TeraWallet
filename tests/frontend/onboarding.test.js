import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_PASSWORD,
  fillBoxes,
  passwordStrength,
  phraseWords,
} from "../../public/tera/core/onboarding.js";

test("a password under 8 characters is refused; 8 or more never is", () => {
  assert.equal(MIN_PASSWORD, 8);
  assert.deepEqual(passwordStrength("Ab1!xyz"), { score: 0, label: "Too short", ok: false });
  for (const p of ["aaaaaaaa", "12345678", "password1", "qwertyui", "Tera2026!"])
    assert.equal(passwordStrength(p).ok, true, p);
});

test("runs, repeats and common words are weak whatever their length", () => {
  for (const p of [
    "aaaaaaaaaaaaaaaaaa",
    "12345678",
    "abcdefghijklmnop",
    "87654321",
    "Password123!",
    "terawallet!!",
    "ababababababab",
  ])
    assert.equal(passwordStrength(p).label, "Weak", p);
});

test("length and a mix of characters raise the score", () => {
  assert.equal(passwordStrength("gravelpond").label, "Weak");
  assert.equal(passwordStrength("gravelpond42").label, "Fair");
  assert.equal(passwordStrength("Gravel-Pond-42").label, "Strong");
  assert.equal(passwordStrength("Gravel-Pond-Lantern-42").label, "Very strong");
  assert.equal(passwordStrength("gravel pond lantern oak").label, "Strong");
});

test("pasted phrases lose numbering, punctuation and case", () => {
  assert.deepEqual(phraseWords("1. Abandon 2. ability\n3) able, about;"), [
    "abandon",
    "ability",
    "able",
    "about",
  ]);
  assert.deepEqual(phraseWords("  "), []);
});

test("pasting fills the boxes in order and switches to 24 when needed", () => {
  const twelve = "a b c d e f g h i j k l";
  assert.deepEqual(fillBoxes(Array(12).fill(""), 0, twelve), twelve.split(" "));
  const twentyFour = Array.from({ length: 24 }, (_, i) => `w${"abcdefghijklmnopqrstuvwx"[i]}`).join(
    " ",
  );
  assert.equal(fillBoxes(Array(12).fill(""), 0, twentyFour).length, 24);
  const partial = fillBoxes(Array(12).fill(""), 3, "x y");
  assert.deepEqual(partial.slice(2, 6), ["", "x", "y", ""]);
  assert.equal(fillBoxes(Array(12).fill(""), 10, "x y z").length, 12);
});
