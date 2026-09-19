import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  RESERVED,
  SCOPE,
  TagError,
  claimMessage,
  display,
  isTag,
  looksLikeTag,
  normalise,
  parseTag,
  releaseMessage,
  skeleton,
} from "../../public/tera/core/tags.js";

const ADDRESS = "0x5b2759f9620f54a5E1651A567Ebd8381F07f9f05";
test("a plain tag is accepted with or without the leading @", () => {
  assert.deepEqual(parseTag("astra"), { ok: true, tag: "astra", reason: "" });
  assert.equal(parseTag("@astra").tag, "astra");
  assert.equal(parseTag("  @Astra  ").tag, "astra");
});

test("a fullwidth tag folds to the same name rather than being refused", () => {
  // NFKC maps these to ASCII, so this is the same claim typed on a different
  // keyboard — not a second name that looks like the first.
  assert.equal(parseTag("＠ａstra").tag, "astra");
});

test("a Cyrillic lookalike is refused, and the reason says why", () => {
  // U+0430 does not fold to "a" under NFKC, so it fails the charset. This is
  // the case the ASCII-only rule exists for.
  const result = parseTag("\u0430stra");
  assert.equal(result.ok, false);
  assert.equal(result.tag, "");
  assert.match(result.reason, /another alphabet/i);
});

test("length, shape and reserved names each refuse with their own reason", () => {
  assert.match(parseTag("as").reason, new RegExp(`${LIMITS.minLength} characters`));
  assert.match(parseTag("a".repeat(LIMITS.maxLength + 1)).reason, /at most/i);
  assert.match(parseTag("1astra").reason, /starts with a letter/i);
  assert.match(parseTag("astra_").reason, /underscore/i);
  assert.match(parseTag("as__tra").reason, /two underscores/i);
  assert.match(parseTag("support").reason, /reserved/i);
  assert.ok(RESERVED.has("tera"));
});

test("an empty field is not an error about characters", () => {
  assert.equal(parseTag("").reason, "Enter a tag.");
  assert.equal(parseTag(null).reason, "Enter a tag.");
});

test("confusable names share a skeleton, so the second cannot be claimed", () => {
  assert.equal(skeleton("astr0"), skeleton("astro"));
  assert.equal(skeleton("as_tra"), skeleton("astra"));
  assert.equal(skeleton("a5tra"), skeleton("astra"));
  assert.equal(skeleton("l1sa"), skeleton("lisa"));
  assert.notEqual(skeleton("astra"), skeleton("astrid"));
});

test("normalise throws for service code, isTag never does", () => {
  assert.equal(normalise("@Astra"), "astra");
  assert.throws(() => normalise("@@"), TagError);
  assert.equal(isTag("@@"), false);
  assert.equal(isTag("astra"), true);
});

test("a tag is shown with exactly one @", () => {
  assert.equal(display("astra"), "@astra");
  assert.equal(display("@astra"), "@astra");
});

test("an address is never mistaken for a tag", () => {
  assert.equal(looksLikeTag(ADDRESS), false);
  assert.equal(looksLikeTag("0xdead"), false);
  // Too short to claim, but still a tag attempt: the owner should be told the
  // tag is short, not that this is a bad address.
  assert.equal(looksLikeTag("@as"), true);
  assert.equal(looksLikeTag("astra"), true);
});

test("the claim message commits to the normalised tag and the lowercased address", () => {
  const message = claimMessage({ tag: "@Astra", address: ADDRESS, timestamp: 1758268800000 });
  assert.equal(
    message,
    "Tera Wallet tag claim\nTag: @astra\nWallet: 0x5b2759f9620f54a5e1651a567ebd8381f07f9f05\nTimestamp: 1758268800000",
  );
  // The same claim typed differently signs the same bytes, so the service
  // cannot be handed a variant the owner never saw.
  assert.equal(
    message,
    claimMessage({ tag: "astra", address: ADDRESS.toLowerCase(), timestamp: 1758268800000 }),
  );
});

test("a release cannot be signed by someone who was shown a claim", () => {
  const fields = { tag: "astra", address: ADDRESS, timestamp: 1758268800000 };
  assert.notEqual(claimMessage(fields), releaseMessage(fields));
  assert.match(releaseMessage(fields), /^Tera Wallet tag release\n/);
});

test("an incomplete claim is refused rather than signed as a blank", () => {
  assert.throws(
    () => claimMessage({ tag: "astra", address: "not-an-address", timestamp: 1 }),
    TagError,
  );
  assert.throws(() => claimMessage({ tag: "astra", address: ADDRESS, timestamp: 0 }), TagError);
  assert.throws(() => claimMessage({ tag: "..", address: ADDRESS, timestamp: 1 }), TagError);
});

test("tags are not offered as bridge destinations", () => {
  // A tag resolves to a Robinhood Chain address. The bridge sends to Base,
  // Solana or Arc, where that address is a different account or none at all.
  assert.equal(SCOPE.bridge, false);
  assert.equal(SCOPE.transfer, true);
  assert.equal(SCOPE.privateSend, true);
});

test("tags are not offered as bridge destinations", () => {
  // A tag resolves to a Robinhood Chain address. The bridge sends to Base,
  // Solana or Arc, where that address is a different account or none at all.
  assert.equal(SCOPE.bridge, false);
  assert.equal(SCOPE.transfer, true);
  assert.equal(SCOPE.privateSend, true);
});
