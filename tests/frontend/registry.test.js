import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND,
  DOMAIN,
  FROM_PAGE,
  INDEPENDENT,
  PASS,
  FAIL,
  UNVERIFIABLE,
  LIMITS,
  RegistryError,
  parseRegistry,
  signingMessage,
  verifyRegistry,
  lookup,
  releaseCheck,
} from "../../public/tera/core/registry.js";

const SIGNER = "0x8ba1f109551bd432803012645ac136ddd64dba72";

const registry = (overrides = {}) => ({
  registry: KIND,
  version: 1,
  algorithm: "sha256",
  publishedAt: "2026-09-18T00:00:00.000Z",
  builds: [
    {
      release: "r-ffd0e45a1b2c",
      filesHash: "sha256-AAAA",
      publishedAt: "2026-09-18T00:00:00.000Z",
    },
    {
      release: "r-6f16d7d33445",
      filesHash: "sha256-BBBB",
      publishedAt: "2026-09-17T00:00:00.000Z",
    },
  ],
  signer: SIGNER,
  signature: "0xsig",
  ...overrides,
});

const receipt = (release) => ({ release });

// Recovers only when handed the exact message the registry commits to.
const recover = async (message, signature) =>
  signature === "0xsig" && message === signingMessage(registry()) ? SIGNER : "0xdead";

test("a release that was never published fails, and says which reading applies", () => {
  // The case the old check could not distinguish from a real build at all.
  const result = releaseCheck(receipt("r-000000000000"), registry(), {
    origin: INDEPENDENT,
    authentic: true,
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /not in the approved-build registry/i);
  assert.match(result.detail, /or the registry is not the one that covers it/i);
});

test("a match checked independently is a pass, scoped to what it establishes", () => {
  const result = releaseCheck(receipt("r-ffd0e45a1b2c"), registry(), {
    origin: INDEPENDENT,
    authentic: true,
  });
  assert.equal(result.status, PASS);
  assert.match(result.detail, /signed approved-build registry/i);
  // It must not be allowed to read as "this page was running that build".
  assert.match(result.detail, /not that the page which wrote this receipt was running it/i);
});

test("the same match inside the wallet is not a second opinion", () => {
  // The whole honesty of the module. A page that misreports its release would
  // also misreport the list it checked against, because it fetched both.
  const result = releaseCheck(receipt("r-ffd0e45a1b2c"), registry(), {
    origin: FROM_PAGE,
    authentic: true,
  });
  assert.equal(result.status, UNVERIFIABLE);
  assert.match(result.detail, /not a second opinion/i);
  assert.match(result.detail, /offline verifier/i);
});

test("an unsigned registry cannot upgrade anything", () => {
  const result = releaseCheck(receipt("r-ffd0e45a1b2c"), registry(), {
    origin: INDEPENDENT,
    authentic: false,
  });
  assert.equal(result.status, UNVERIFIABLE);
  assert.match(result.detail, /anybody could have written/i);
});

test("no registry leaves the check exactly where it was", () => {
  const result = releaseCheck(receipt("r-ffd0e45a1b2c"), null, { origin: INDEPENDENT });
  assert.equal(result.status, UNVERIFIABLE);
  assert.match(result.detail, /No approved-build registry was available/i);
});

test("a receipt with no release is reported as such, not as a miss", () => {
  const result = releaseCheck(receipt(""), registry(), { origin: INDEPENDENT, authentic: true });
  assert.equal(result.status, UNVERIFIABLE);
  assert.match(result.detail, /No release was recorded/i);
});

test("a malformed registry is refused rather than half-read", () => {
  assert.throws(() => parseRegistry("not json"), RegistryError);
  assert.throws(() => parseRegistry({ registry: "something else" }), RegistryError);
  assert.throws(() => parseRegistry(registry({ algorithm: "md5" })), RegistryError);
  assert.throws(() => parseRegistry(registry({ builds: [] })), RegistryError);
  // A release id has a shape, and something that is not one is not a build.
  assert.throws(() => parseRegistry(registry({ builds: [{ release: "latest" }] })), RegistryError);
  assert.throws(
    () => parseRegistry(registry({ builds: [{ release: "r-ffd0e45a1b2c" }] })),
    RegistryError,
    "a build with no file hash is not a build",
  );
});

test("a well-formed registry is not thereby an authentic one", async () => {
  // Shape and authorship are separate calls so neither can be mistaken for the
  // other. parseRegistry accepting a document says nothing about who wrote it.
  const doc = parseRegistry(registry());
  assert.equal(doc.builds.length, 2);

  const verified = await verifyRegistry(doc, { recover, expectedSigner: SIGNER });
  assert.equal(verified.ok, true);
});

test("a signature with no expected signer proves only that somebody signed", async () => {
  const result = await verifyRegistry(registry(), { recover });
  assert.equal(result.ok, false);
  assert.match(result.reason, /only that somebody signed it/i);
});

test("a registry signed by the wrong key is refused", async () => {
  const result = await verifyRegistry(registry(), {
    recover,
    expectedSigner: "0x0000000000000000000000000000000000000001",
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not by the expected key/i);
});

test("an unsigned registry reports as unsigned rather than failing quietly", async () => {
  const result = await verifyRegistry(registry({ signature: undefined, signer: undefined }), {
    recover,
    expectedSigner: SIGNER,
  });
  assert.equal(result.ok, false);
  assert.equal(result.signed, false);
  assert.match(result.reason, /unsigned/i);
});

test("editing a build after signing breaks the signature", async () => {
  // The signed message commits to every release and file hash, sorted, so
  // adding a build or changing one changes what the signature covers.
  const tampered = registry({
    builds: [
      { release: "r-ffd0e45a1b2c", filesHash: "sha256-CHANGED", publishedAt: "2026-09-18" },
      { release: "r-6f16d7d33445", filesHash: "sha256-BBBB", publishedAt: "2026-09-17" },
    ],
  });
  const result = await verifyRegistry(tampered, { recover, expectedSigner: SIGNER });
  assert.equal(result.ok, false);
});

test("the signed message is domain-separated and order-independent", () => {
  assert.equal(signingMessage(registry()).startsWith(DOMAIN), true);
  const reversed = registry({ builds: [...registry().builds].reverse() });
  assert.equal(
    signingMessage(registry()),
    signingMessage(reversed),
    "the order builds happen to be listed in must not change the signature",
  );
});

test("lookup finds a build and misses cleanly", () => {
  assert.equal(lookup(registry(), "r-ffd0e45a1b2c").filesHash, "sha256-AAAA");
  assert.equal(lookup(registry(), "r-000000000000"), null);
  assert.equal(lookup(null, "r-ffd0e45a1b2c"), null);
});

test("the limits refuse the reading the feature invites", () => {
  const text = LIMITS.join(" ").toLowerCase();
  assert.ok(
    text.includes("does not establish that the page"),
    "a registry must never be read as proof about the running page",
  );
  assert.ok(text.includes("not a second opinion"));
  assert.ok(text.includes("tera can rewrite it"), "who controls the file must be admitted");
});
