import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import {
  SELECTORS,
  TagCallError,
  availableOnChain,
  decodeAddress,
  decodeBool,
  decodeString,
  encodeAvailable,
  encodeResolve,
  encodeTagOf,
  resolveOnChain,
  tagOfOnChain,
} from "../../public/tera/core/tags-chain.js";

const REGISTRY = "0x1111111111111111111111111111111111111111";
const ASTRA = "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05";
const abi = parseAbi([
  "function resolve(string tag) view returns (address)",
  "function tagOf(address owner) view returns (string)",
  "function available(string tag) view returns (bool)",
]);

const answering = (hex) => async () => hex;
const word = (value) => BigInt(value).toString(16).padStart(64, "0");

test("the hardcoded selectors are the contract's", () => {
  // A wrong selector reads as "no such tag" rather than as an error, which is
  // the failure most likely to be mistaken for a normal empty answer.
  assert.equal(SELECTORS.resolve, toFunctionSelector("function resolve(string)"));
  assert.equal(SELECTORS.tagOf, toFunctionSelector("function tagOf(address)"));
  assert.equal(SELECTORS.available, toFunctionSelector("function available(string)"));
});

test("the hand-written encoding matches a real ABI encoder", () => {
  for (const tag of ["astra", "a".repeat(20), "as_tra", "abc"]) {
    assert.equal(
      encodeResolve(tag),
      encodeFunctionData({ abi, functionName: "resolve", args: [tag] }),
      tag,
    );
    assert.equal(
      encodeAvailable(tag),
      encodeFunctionData({ abi, functionName: "available", args: [tag] }),
      tag,
    );
  }
  assert.equal(
    encodeTagOf(ASTRA),
    encodeFunctionData({ abi, functionName: "tagOf", args: [ASTRA] }),
  );
});

test("a checksummed address encodes the same as a lowercase one", () => {
  assert.equal(encodeTagOf(ASTRA), encodeTagOf(ASTRA.toUpperCase().replace("0X", "0x")));
  assert.throws(() => encodeTagOf("not-an-address"), TagCallError);
});

test("an unclaimed tag decodes to null, not to the zero address", () => {
  assert.equal(decodeAddress(`0x${word(0)}`), null);
  assert.equal(decodeAddress(`0x${"0".repeat(24)}${ASTRA.slice(2)}`), ASTRA);
});

test("a short or empty answer is an error, never an empty result", () => {
  // "0x" is what an RPC returns for a call to an address with no contract. A
  // decoder that padded it would report every tag as unclaimed.
  assert.throws(() => decodeAddress("0x"), TagCallError);
  assert.throws(() => decodeBool("0x"), TagCallError);
  assert.throws(() => decodeString("0x"), TagCallError);
});

test("a string return decodes, including the empty one", () => {
  const encoded = `0x${word(32)}${word(5)}${Buffer.from("astra").toString("hex").padEnd(64, "0")}`;
  assert.equal(decodeString(encoded), "astra");
  assert.equal(decodeString(`0x${word(32)}${word(0)}`), "");
});

test("a truncated string answer is refused rather than half read", () => {
  // Claims twenty bytes and then stops after four.
  const truncated = `0x${word(32)}${word(20)}${Buffer.from("astr").toString("hex")}`;
  assert.throws(() => decodeString(truncated), TagCallError);
});

test("resolveOnChain carries the tag and the address together", async () => {
  const result = await resolveOnChain({
    call: answering(`0x${"0".repeat(24)}${ASTRA.slice(2)}`),
    registry: REGISTRY,
    tag: "astra",
  });
  assert.deepEqual(result, { tag: "astra", address: ASTRA, source: "chain" });
});

test("resolveOnChain sends the call to the registry with the right data", async () => {
  let seen = null;
  await resolveOnChain({
    call: async (request) => {
      seen = request;
      return `0x${word(0)}`;
    },
    registry: REGISTRY,
    tag: "astra",
  });
  assert.deepEqual(seen, { to: REGISTRY, data: encodeResolve("astra") });
});

test("a wallet that does not know the registry address refuses to guess", async () => {
  await assert.rejects(
    () => resolveOnChain({ call: answering("0x"), registry: "", tag: "astra" }),
    TagCallError,
  );
  await assert.rejects(
    () => resolveOnChain({ call: null, registry: REGISTRY, tag: "astra" }),
    TagCallError,
  );
});

test("a failing call throws rather than answering 'unclaimed'", async () => {
  // At a payment form, "we could not ask" and "nobody holds this name" must
  // not be the same outcome.
  await assert.rejects(
    () =>
      resolveOnChain({
        call: async () => {
          throw new Error("network down");
        },
        registry: REGISTRY,
        tag: "astra",
      }),
    /network down/,
  );
});

test("the reverse lookup and availability read through the same path", async () => {
  const name = `0x${word(32)}${word(5)}${Buffer.from("astra").toString("hex").padEnd(64, "0")}`;
  assert.equal(
    await tagOfOnChain({ call: answering(name), registry: REGISTRY, address: ASTRA }),
    "astra",
  );
  assert.equal(
    await tagOfOnChain({
      call: answering(`0x${word(32)}${word(0)}`),
      registry: REGISTRY,
      address: ASTRA,
    }),
    null,
  );
  assert.equal(
    await availableOnChain({ call: answering(`0x${word(1)}`), registry: REGISTRY, tag: "astra" }),
    true,
  );
  assert.equal(
    await availableOnChain({ call: answering(`0x${word(0)}`), registry: REGISTRY, tag: "astra" }),
    false,
  );
});
