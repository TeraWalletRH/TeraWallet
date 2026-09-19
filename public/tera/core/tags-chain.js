// Reading the tag registry, from whichever surface is asking.
//
// The service will happily tell a wallet which address `@astra` is. Believing
// it is the part this module exists to avoid: an index that lags by a block
// answers with the *previous* holder of a name, and a service that has been
// tampered with answers with whatever it likes. Either way the owner is shown
// a name they trust and an address they do not read.
//
// So the answer that reaches a confirmation screen is read from the chain, by
// the same `eth_call` path the wallet already uses for balances, and the
// service's answer is treated as a suggestion for autocomplete and nothing
// more. That is the whole difference between a hint and a recipient.
//
// The encoding is written out here rather than pulled from an ABI library
// because the web wallet ships no such library, and because two functions
// taking one argument each is less code than the loader would be. The
// selectors are constants, checked against the contract by a test that
// recomputes them — a wrong selector would otherwise read as "no such tag",
// which is the failure that looks most like a normal empty answer.
//
// `call` is injected. On the web it is the provider's `eth_call`; on Android it
// is viem's public client; in tests it is a function returning a fixed word.
// This module opens no connections of its own.

export class TagCallError extends Error {}

/** keccak256("resolve(string)")[0..4] and friends. Verified in tags-chain.test.js. */
export const SELECTORS = {
  resolve: "0x461a4478",
  tagOf: "0x15f26c91",
  available: "0xaeb8ce9b",
  nonces: "0x7ecebe00",
};

export const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

const strip = (hex) => String(hex ?? "").replace(/^0x/, "");
const word = (value) => BigInt(value).toString(16).padStart(64, "0");

function encodeString(text) {
  const bytes = new TextEncoder().encode(text);
  let body = "";
  for (const byte of bytes) body += byte.toString(16).padStart(2, "0");
  // Right-padded to a whole number of words, as the ABI requires.
  const padded = body.padEnd(Math.ceil(body.length / 64) * 64 || 64, "0");
  return word(bytes.length) + padded;
}

/** `resolve(string)` — the call whose answer may become a recipient. */
export const encodeResolve = (tag) =>
  `${SELECTORS.resolve}${word(32)}${encodeString(String(tag ?? ""))}`;

/** `available(string)` — used by the claim screen. */
export const encodeAvailable = (tag) =>
  `${SELECTORS.available}${word(32)}${encodeString(String(tag ?? ""))}`;

const addressArgument = (address) => {
  const raw = strip(address).toLowerCase();
  if (!/^[\da-f]{40}$/.test(raw)) throw new TagCallError("A wallet address is required.");
  return raw.padStart(64, "0");
};

/** `tagOf(address)` — the reverse lookup, for showing an owner their own name. */
export const encodeTagOf = (address) => `${SELECTORS.tagOf}${addressArgument(address)}`;

/** `nonces(address)` — the replay counter a claim signature has to commit to. */
export const encodeNonces = (address) => `${SELECTORS.nonces}${addressArgument(address)}`;

/**
 * Read one address out of a 32-byte word.
 *
 * A short answer is refused rather than padded. An RPC that returns `0x` for a
 * call to an address with no contract would otherwise decode to the zero
 * address, which reads as "this tag is unclaimed" — a wrong answer that looks
 * exactly like a right one.
 */
export function decodeAddress(hex) {
  const raw = strip(hex);
  if (raw.length !== 64) throw new TagCallError("The registry did not answer this lookup.");
  const address = `0x${raw.slice(24)}`;
  return address === ZERO_ADDRESS ? null : address;
}

/** Read a `uint256` word as a JavaScript number, refusing anything unsafe. */
export function decodeUint(hex) {
  const raw = strip(hex);
  if (raw.length !== 64) throw new TagCallError("The registry did not answer this lookup.");
  const value = BigInt(`0x${raw}`);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new TagCallError("The registry answered with a number this wallet cannot use.");
  return Number(value);
}

/** Read a `bool` word. Same refusal on a short answer, for the same reason. */
export function decodeBool(hex) {
  const raw = strip(hex);
  if (raw.length !== 64) throw new TagCallError("The registry did not answer this lookup.");
  return BigInt(`0x${raw}`) === 1n;
}

/** Read a dynamic `string` return value. */
export function decodeString(hex) {
  const raw = strip(hex);
  if (raw.length < 128) {
    if (raw.length === 0) throw new TagCallError("The registry did not answer this lookup.");
    return "";
  }
  const offset = Number(BigInt(`0x${raw.slice(0, 64)}`));
  const at = offset * 2;
  const length = Number(BigInt(`0x${raw.slice(at, at + 64)}`));
  if (!length) return "";
  const body = raw.slice(at + 64, at + 64 + length * 2);
  if (body.length < length * 2) throw new TagCallError("The registry answer was truncated.");
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1)
    bytes[index] = parseInt(body.slice(index * 2, index * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

/**
 * Resolve a tag against the registry contract.
 *
 * Returns the address and the tag together, so a caller cannot carry one
 * without the other into a review screen. `null` means the name is genuinely
 * unclaimed; a failed call throws, because "we could not ask" and "nobody
 * holds this" must not be the same outcome at a payment form.
 */
export async function resolveOnChain({ call, registry, tag }) {
  if (typeof call !== "function") throw new TagCallError("No way to read the registry.");
  if (!/^0x[\da-fA-F]{40}$/.test(String(registry ?? "")))
    throw new TagCallError("This wallet does not know where the tag registry is.");
  const name = String(tag ?? "");
  if (!name) throw new TagCallError("Enter a tag.");
  const answer = await call({ to: registry, data: encodeResolve(name) });
  return { tag: name, address: decodeAddress(answer), source: "chain" };
}

/** The reverse: the tag an address holds, or null. */
export async function tagOfOnChain({ call, registry, address }) {
  if (typeof call !== "function") throw new TagCallError("No way to read the registry.");
  const answer = await call({ to: registry, data: encodeTagOf(address) });
  return decodeString(answer) || null;
}

/** Whether a name can still be claimed. */
export async function availableOnChain({ call, registry, tag }) {
  if (typeof call !== "function") throw new TagCallError("No way to read the registry.");
  const answer = await call({ to: registry, data: encodeAvailable(String(tag ?? "")) });
  return decodeBool(answer);
}

/** The owner's current claim nonce, which their signature has to match. */
export async function noncesOnChain({ call, registry, address }) {
  if (typeof call !== "function") throw new TagCallError("No way to read the registry.");
  return decodeUint(await call({ to: registry, data: encodeNonces(address) }));
}
