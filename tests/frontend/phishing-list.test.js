import { test } from "node:test";
import assert from "node:assert/strict";
import { hostnameOf, isListed } from "../../public/tera/core/phishing-list.js";

test("hostnameOf reads the hostname out of a URL, lowercased", () => {
  assert.equal(hostnameOf("https://Evil.IO/connect"), "evil.io");
  assert.equal(hostnameOf("http://localhost:3000"), "localhost");
  assert.equal(hostnameOf("not a url"), "");
  assert.equal(hostnameOf(""), "");
  assert.equal(hostnameOf(undefined), "");
});

test("isListed checks a hostname against an array or a Set", () => {
  assert.equal(isListed("evil.io", ["evil.io", "scam.xyz"]), true);
  assert.equal(isListed("evil.io", new Set(["evil.io"])), true);
  assert.equal(isListed("good.io", ["evil.io"]), false);
  assert.equal(isListed("", ["evil.io"]), false);
  assert.equal(isListed("evil.io", undefined), false);
  assert.equal(isListed("evil.io", null), false);
});
