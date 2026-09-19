import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CLAIM_TYPES,
  DOMAIN_NAME,
  DOMAIN_VERSION,
  LIMITS,
  RELEASE_TYPES,
  RESERVED,
  SCOPE,
  TagError,
  claimTypedData,
  eip712Payload,
  display,
  isTag,
  looksLikeTag,
  normalise,
  parseTag,
  releaseTypedData,
  skeleton,
} from "../../public/tera/core/tags.js";

const ADDRESS = "0x5b2759f9620f54a5E1651A567Ebd8381F07f9f05";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 4663;
const DEADLINE = 1_758_268_800;

const signable = (overrides = {}) => ({
  tag: "@Astra",
  owner: ADDRESS,
  nonce: 0,
  deadline: DEADLINE,
  chainId: CHAIN_ID,
  registry: REGISTRY,
  ...overrides,
});

/** The EIP-712 encodeType string, which is what the contract's typehash hashes. */
const encodeType = (types) => {
  const [name, fields] = Object.entries(types)[0];
  return `${name}(${fields.map((field) => `${field.type} ${field.name}`).join(",")})`;
};

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

test("the claim payload normalises the tag and carries the domain", () => {
  const typed = claimTypedData(signable());
  assert.equal(typed.primaryType, "Claim");
  assert.deepEqual(typed.domain, {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: CHAIN_ID,
    verifyingContract: REGISTRY,
  });
  assert.equal(typed.message.tag, "astra");
  assert.equal(typed.message.owner, ADDRESS);
  assert.equal(typed.message.nonce, 0n);
  assert.equal(typed.message.deadline, BigInt(DEADLINE));
});

test("a claim struct is not a release struct", () => {
  const claim = claimTypedData(signable());
  const release = releaseTypedData(signable());
  assert.equal(release.primaryType, "Release");
  assert.notDeepEqual(claim.types, release.types);
  // A release carries no tag, so a signature over one cannot name a name.
  assert.equal("tag" in release.message, false);
});

test("the typed-data structs are the preimages of the contract's typehashes", async () => {
  // Read rather than recomputed: the point is that TagRegistry.sol and this
  // module describe the same struct, and a hash computed from this file would
  // agree with itself no matter what the contract says.
  const solidity = await readFile(
    fileURLToPath(new URL("../../contracts/src/registry/TagRegistry.sol", import.meta.url)),
    "utf8",
  );
  assert.equal(
    encodeType(CLAIM_TYPES),
    "Claim(string tag,address owner,uint256 nonce,uint256 deadline)",
  );
  assert.ok(solidity.includes(`keccak256("${encodeType(CLAIM_TYPES)}")`), "claim typehash drifted");
  assert.ok(
    solidity.includes(`keccak256("${encodeType(RELEASE_TYPES)}")`),
    "release typehash drifted",
  );
  assert.ok(solidity.includes(`EIP712("${DOMAIN_NAME}", "${DOMAIN_VERSION}")`), "domain drifted");
});

test("the deadline must be in seconds, because the contract compares block.timestamp", () => {
  // Date.now() here would sign a claim good for fifty thousand years.
  assert.throws(() => claimTypedData(signable({ deadline: Date.now() })), TagError);
  assert.throws(() => releaseTypedData(signable({ deadline: Date.now() })), TagError);
});

test("an incomplete claim is refused rather than signed as a blank", () => {
  assert.throws(() => claimTypedData(signable({ owner: "not-an-address" })), TagError);
  assert.throws(() => claimTypedData(signable({ registry: "0x00" })), TagError);
  assert.throws(() => claimTypedData(signable({ chainId: 0 })), TagError);
  assert.throws(() => claimTypedData(signable({ nonce: -1 })), TagError);
  assert.throws(() => claimTypedData(signable({ deadline: 0 })), TagError);
  assert.throws(() => claimTypedData(signable({ tag: ".." })), TagError);
});

test("tags are not offered as bridge destinations", () => {
  // A tag resolves to a Robinhood Chain address. The bridge sends to Base,
  // Solana or Arc, where that address is a different account or none at all.
  assert.equal(SCOPE.bridge, false);
  assert.equal(SCOPE.transfer, true);
  assert.equal(SCOPE.privateSend, true);
});

test("the browser payload carries the domain type and stringified numbers", () => {
  // A browser wallet is handed JSON over JSON-RPC: BigInt does not survive
  // JSON.stringify, and it needs EIP712Domain spelled out. viem adds both for
  // the Android app, so this is what keeps the two surfaces signing the same
  // struct rather than nearly the same one.
  const payload = eip712Payload(claimTypedData(signable()));
  assert.equal(payload.primaryType, "Claim");
  assert.deepEqual(
    payload.types.EIP712Domain.map((field) => field.name),
    ["name", "version", "chainId", "verifyingContract"],
  );
  assert.deepEqual(payload.types.Claim, CLAIM_TYPES.Claim);
  assert.equal(payload.message.nonce, "0");
  assert.equal(payload.message.deadline, String(DEADLINE));
  assert.equal(payload.message.tag, "astra");
  // It must survive the trip through JSON-RPC unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
});
