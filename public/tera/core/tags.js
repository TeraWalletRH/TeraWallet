// Tags: a name an owner claims, and the address it stands for.
//
// `@astra` is easier to read back to someone than 0x5b27…9f05, and that is the
// whole of its value. It is also, for exactly the same reason, the best place
// in this wallet to put a transaction in front of the wrong person: an owner
// who checks forty hex characters will not check a word they already trust.
//
// So this module holds the part of tags that must be identical everywhere —
// what a tag may be, what two tags being "the same" means, and the exact bytes
// an owner signs to claim one. It resolves nothing and fetches nothing. A name
// is turned into an address by the registry contract, never here, and the
// address is what every later check binds to: `validation.ts` rebuilds calldata
// from the resolved address, and a review screen shows both.
//
// Three rules shape the grammar below, and each one is a test:
//
//   ASCII only, after NFKC. Fullwidth `ａstra` folds to `astra` and is the same
//   claim. Cyrillic `аstra` does not fold, fails the charset, and is refused —
//   not quietly mapped to something else. A name this wallet cannot spell in
//   one way is not a name it will accept.
//
//   Confusable names collide. `astr0` and `astro` have the same skeleton, so
//   the second cannot be claimed while the first exists. The fold is
//   deliberately aggressive: a collision costs a claimant an alternative name,
//   a miss costs somebody their money, and those are not comparable.
//
//   The claim payload is built here or not at all. Both surfaces sign what
//   this module produces, and its EIP-712 types are the literal preimages of
//   the typehashes in TagRegistry.sol, so a claim cannot be accepted against a
//   struct the owner never saw.
//
// What a tag is not: a chain-agnostic identity. Every record here stands for
// one address on Robinhood Chain. A bridge destination is an address on another
// chain and tags must not be offered there — see `SCOPE` at the end of this
// file for where that is enforced and why it is not a UI detail.

export const TagError = class TagError extends Error {};

/** The published shape of a tag, quoted in the claim UI and in the tests. */
export const LIMITS = {
  minLength: 3,
  maxLength: 20,
  charset: "a-z, 0-9 and underscore",
  shape: "starts with a letter, no trailing or doubled underscore",
};

const WELL_FORMED = /^[a-z][a-z0-9_]{1,18}[a-z0-9]$/;

/**
 * Names the wallet answers to itself, and names that would make a payment
 * screen read as an instruction rather than a destination.
 *
 * Squatting on `@support` is not a clever trick, it is the oldest one, and the
 * cost of over-reserving is that somebody has to pick a different word.
 */
export const RESERVED = new Set([
  "tera",
  // Underscores fold away, so this also withholds "tera_wallet".
  "terawallet",
  "terateam",
  "team",
  "admin",
  "administrator",
  "root",
  "system",
  "official",
  "verified",
  "support",
  "help",
  "helpdesk",
  "security",
  "recovery",
  "wallet",
  "staking",
  "stake",
  "rewards",
  "airdrop",
  "treasury",
  "vault",
  "bridge",
  "swap",
  "send",
  "deposit",
  "withdraw",
  "refund",
  "fee",
  "gas",
  "null",
  "none",
  "undefined",
  "anonymous",
  "robinhood",
  "usdg",
]);

/**
 * The characters that get read as each other at a glance, folded to one.
 *
 * This is not a transliteration table and is not meant to be reversible. It
 * exists to answer one question — could a hurried owner mistake this name for
 * that one — and it answers it by throwing away the distinctions that carry
 * the confusion. Underscores go entirely, because `as_tra` and `astra` are the
 * same word to someone reading a confirmation sheet.
 */
const CONFUSABLE = { 0: "o", 1: "l", i: "l", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", 9: "g" };

/**
 * The comparison key for "is this name already taken".
 *
 * Two tags with the same skeleton may not both exist. Storage keeps this
 * alongside the tag so the uniqueness constraint is the database's job rather
 * than a check someone can forget to call.
 */
export function skeleton(tag) {
  return String(tag ?? "")
    .toLowerCase()
    .replace(/_/g, "")
    .split("")
    .map((character) => CONFUSABLE[character] ?? character)
    .join("");
}

/**
 * Read what the owner typed and return the canonical tag.
 *
 * Accepts a leading `@` and surrounding space because both are what people
 * type; accepts fullwidth and other compatibility forms because NFKC folds
 * them to the same name. Everything else is refused with the reason, and the
 * reason is written to be shown to the owner as it is.
 *
 * Returns `{ ok, tag, reason }` rather than throwing: this runs on every
 * keystroke in the recipient field, and a rejected keystroke is the normal
 * case rather than an exception.
 */
export function parseTag(input) {
  const raw = String(input ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  if (!raw) return { ok: false, tag: "", reason: "Enter a tag." };
  if (raw.length < LIMITS.minLength)
    return { ok: false, tag: "", reason: `A tag is at least ${LIMITS.minLength} characters.` };
  if (raw.length > LIMITS.maxLength)
    return { ok: false, tag: "", reason: `A tag is at most ${LIMITS.maxLength} characters.` };
  if (/[^a-z0-9_]/.test(raw))
    return {
      ok: false,
      tag: "",
      // Named rather than generic: a Cyrillic character that looks like an "a"
      // is the case this rule exists for, and "invalid character" would send
      // the owner looking at the wrong part of what they typed.
      reason: `A tag uses only ${LIMITS.charset}. Letters that look alike but are from another alphabet are not accepted.`,
    };
  if (!WELL_FORMED.test(raw))
    return {
      ok: false,
      tag: "",
      reason: "A tag starts with a letter and does not end with an underscore.",
    };
  if (/__/.test(raw))
    return { ok: false, tag: "", reason: "A tag does not contain two underscores in a row." };
  if (RESERVED.has(raw)) return { ok: false, tag: "", reason: "This tag is reserved." };

  return { ok: true, tag: raw, reason: "" };
}

/** The throwing form, for service code where a malformed tag is a bug. */
export function normalise(input) {
  const parsed = parseTag(input);
  if (!parsed.ok) throw new TagError(parsed.reason);
  return parsed.tag;
}

/** True when `input` is a well-formed tag. Never throws. */
export const isTag = (input) => parseTag(input).ok;

/** How a tag is written wherever it is shown to an owner. */
export const display = (tag) => `@${String(tag ?? "").replace(/^@+/, "")}`;

/**
 * Does this look like an attempt at a tag rather than at an address?
 *
 * Used by the recipient field to pick which validation message to show, and by
 * `parse.js` to decide that "pay 50 to @astra" is a transfer at all. It is
 * deliberately looser than `parseTag`: `@as` is a bad tag, not an address, and
 * the owner is better told why their tag is too short than told it is not a
 * valid address.
 */
export const looksLikeTag = (input) => {
  const text = String(input ?? "").trim();
  if (!text || /^0x/i.test(text)) return false;
  return /^@/.test(text) || /^[a-z][a-z0-9_]*$/i.test(text.normalize("NFKC"));
};

/**
 * What an owner signs to claim a tag, as EIP-712 typed data.
 *
 * Built here so there is one definition of what was agreed to, and so the
 * struct cannot drift from `TagRegistry.sol`: the type strings below are the
 * literal preimages of `CLAIM_TYPEHASH` and `RELEASE_TYPEHASH` in that
 * contract, and a test asserts the pair still hash alike.
 *
 * Typed data rather than a readable sentence because the contract is what
 * verifies it, and a contract cannot parse prose. The readable version is the
 * review screen, which shows the tag and the address it will be bound to.
 *
 * `deadline` is in **seconds**, because the contract compares it to
 * `block.timestamp`. Passing milliseconds signs something good for 50,000
 * years, so the builder refuses a value that looks like `Date.now()`.
 *
 * The nonce is the owner's current `nonces(owner)` on the registry. It is read
 * from the chain, never invented, and the contract re-reads it when the claim
 * lands, so a relayer cannot choose which of several signatures to submit.
 */
export const DOMAIN_NAME = "Tera Wallet Tags";
export const DOMAIN_VERSION = "1";

export const CLAIM_TYPES = {
  Claim: [
    { name: "tag", type: "string" },
    { name: "owner", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const RELEASE_TYPES = {
  Release: [
    { name: "owner", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

/** Roughly the year 2100 in seconds. Anything past it was meant as milliseconds. */
const SECONDS_CEILING = 4_102_444_800;

const address = (value, what) => {
  const text = String(value ?? "");
  if (!/^0x[\da-fA-F]{40}$/.test(text)) throw new TagError(`A claim needs ${what}.`);
  return text;
};

function commonFields({ owner, nonce, deadline, chainId, registry }) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new TagError("A claim needs the chain it is for.");
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new TagError("A claim needs a nonce.");
  if (!Number.isSafeInteger(deadline) || deadline <= 0)
    throw new TagError("A claim needs a deadline.");
  if (deadline > SECONDS_CEILING)
    throw new TagError("The deadline must be in seconds, not milliseconds.");
  return {
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId,
      verifyingContract: address(registry, "the registry address"),
    },
    owner: address(owner, "a wallet address"),
    nonce,
    deadline,
  };
}

/** The typed-data payload for claiming `tag`. Pass straight to `signTypedData`. */
export function claimTypedData({ tag, owner, nonce, deadline, chainId, registry }) {
  const name = normalise(tag);
  const common = commonFields({ owner, nonce, deadline, chainId, registry });
  return {
    domain: common.domain,
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: {
      tag: name,
      owner: common.owner,
      nonce: BigInt(common.nonce),
      deadline: BigInt(common.deadline),
    },
  };
}

/** The same, for giving a tag up. A distinct struct, so one cannot be signed as the other. */
export function releaseTypedData({ owner, nonce, deadline, chainId, registry }) {
  const common = commonFields({ owner, nonce, deadline, chainId, registry });
  return {
    domain: common.domain,
    types: RELEASE_TYPES,
    primaryType: "Release",
    message: {
      owner: common.owner,
      nonce: BigInt(common.nonce),
      deadline: BigInt(common.deadline),
    },
  };
}

/**
 * The same payload, shaped for `eth_signTypedData_v4`.
 *
 * A browser wallet is handed JSON over JSON-RPC, so it needs the EIP712Domain
 * type spelled out and the numbers as strings — viem adds both for the Android
 * app, and a surface that assembled this itself would be one edit away from
 * signing a different struct from the other one. So it is assembled here,
 * once, from the same builder.
 */
export function eip712Payload(typed) {
  const message = {};
  for (const [key, value] of Object.entries(typed.message))
    message[key] = typeof value === "bigint" ? value.toString() : value;
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...typed.types,
    },
    primaryType: typed.primaryType,
    domain: typed.domain,
    message,
  };
}

/**
 * Where a tag may stand in for an address, and where it may not.
 *
 * This is here rather than in each surface's form code because the bridge
 * entry is a correctness rule, not a preference. A tag resolves to a Robinhood
 * Chain address; a bridge destination is an address on Base, Solana or Arc. A
 * tag accepted there would name an address that the owner does not control on
 * the destination chain, and may name one somebody else does. Both surfaces
 * read this map, and the test asserts the bridge stays out of it.
 */
export const SCOPE = {
  transfer: true,
  privateSend: true,
  bridge: false,
};

export const scopeRefusal = {
  bridge:
    "A tag names an address on Robinhood Chain. A bridge sends to another chain, where that address is not the same account — paste the destination address instead.",
};
