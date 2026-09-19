// Tags: a name an owner claims, and the address it stands for.
//
// `@astra` is easier to read back to someone than 0x5b27…9f05, and that is the
// whole of its value. It is also, for exactly the same reason, the best place
// in this wallet to put a transaction in front of the wrong person: an owner
// who checks forty hex characters will not check a word they already trust.
//
// So this module holds the part of tags that must be identical everywhere —
// what a tag may be, what two tags being "the same" means, and the exact bytes
// an owner signs to claim one. It resolves nothing and fetches nothing.
//
// A name is turned into an address by Tera's registry service, never here, and
// the address is what every later check binds to: `validation.ts` rebuilds
// calldata from the resolved address, and a review screen shows both. Tera is
// the authority on what a name means, which is a real limit and is stated
// where an owner can read it rather than implied here.
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
//   The claim message is built here or not at all. The client that signs and
//   the service that verifies read the same function, so a claim cannot be
//   accepted against a string the owner never saw.
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
 * The exact text an owner signs to claim a tag.
 *
 * Both ends read this function, so there is one definition of what was agreed
 * to and a claim cannot be accepted against a string the owner never saw. The
 * shape follows the deletion request in `backend/src/routes/retention.ts` —
 * purpose, subject, timestamp — because an owner who has signed one of those
 * should recognise this one.
 *
 * The address is lowercased and the tag normalised before either reaches the
 * message, so the same claim typed differently signs the same bytes and cannot
 * be replayed under a different casing of the same two values.
 *
 * `timestamp` is in milliseconds, matching the other signed requests in this
 * wallet; the service decides the window it will accept.
 */
export function claimMessage({ tag, address, timestamp }) {
  const name = normalise(tag);
  const owner = String(address ?? "").toLowerCase();
  if (!/^0x[\da-f]{40}$/.test(owner)) throw new TagError("A claim needs a wallet address.");
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0)
    throw new TagError("A claim needs a timestamp.");
  return `Tera Wallet tag claim
Tag: ${display(name)}
Wallet: ${owner}
Timestamp: ${timestamp}`;
}

/** The same, for giving a tag up. Distinct text, so one cannot be signed as the other. */
export function releaseMessage({ tag, address, timestamp }) {
  return claimMessage({ tag, address, timestamp }).replace(
    "Tera Wallet tag claim",
    "Tera Wallet tag release",
  );
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
