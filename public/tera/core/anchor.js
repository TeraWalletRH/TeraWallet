// The approved-build registry, read from a chain instead of from Tera.
//
// `registry.js` publishes the list of releases Tera has shipped, signed and dated, and
// says plainly where its weakness is: Tera serves the file. A signature establishes who
// wrote a list, never that the list you were handed is the list everybody else was
// handed. What has stood against a quiet edit until now is that readers keep copies.
//
// `BuildAnchor.sol` is the same list somewhere Tera cannot rewrite it without leaving a
// trace: a release is anchored once, at a block timestamp nobody can move, and taking one
// back is a timelocked proposal that emits before it takes effect. This module is the
// reading half — it encodes the call, decodes the answer, and turns it into one of the
// four states.
//
// It holds no network code on purpose. The wallet reads through the owner's configured
// endpoint, the command-line verifier reads through whatever RPC the reader names, and
// the Android app reads through its own client. Each of those is a different party seeing
// a different thing, and which one asked is half of what the answer is worth — so the
// caller says, with `origin`, and this module never guesses.
//
// The three things this does not establish, in the order people assume them:
//
//   It does not establish that the page which wrote a receipt was running an anchored
//   build. Nothing on chain can. The page naming its release is the page being asked
//   about, and anchoring makes the published list tamper-evident, not the page honest.
//
//   Read from inside the wallet it is not a second opinion, for the same reason the
//   registry is not: the page chose the endpoint it asked. A `pass` there would be the
//   page confirming its own claim through a channel it also picked.
//
//   It is not an attestation. Tera runs no enclave, nothing measures this code as it
//   executes, and the anchor carries no TCB field precisely so that nobody reads one.
//
// What it does establish is narrow and worth having: a receipt naming a build that was
// never anchored, or one anchored against different code, or one Tera has since
// withdrawn, can now be told apart from a receipt naming a build that was published and
// still stands — by a reader who asks a chain rather than asking Tera.

import { PASS, FAIL, UNVERIFIABLE, SKIPPED } from "./verdict.js";

export { PASS, FAIL, UNVERIFIABLE, SKIPPED };

/** The gate's name, shared with `checks.js` and the Android review sheet. */
export const GATE_ZERO = "build_anchor";

/** Where the chain was read from, which decides what an answer is worth. */
export const FROM_PAGE = "page";
export const INDEPENDENT = "independent";

/** `BuildAnchor.Status`, in the contract's own order. */
export const UNKNOWN = 0;
export const ANCHORED = 1;
export const MISMATCH = 2;
export const WITHDRAWN = 3;

export const STATUS_NAMES = {
  [UNKNOWN]: "unknown",
  [ANCHORED]: "anchored",
  [MISMATCH]: "mismatch",
  [WITHDRAWN]: "withdrawn",
};

/**
 * The calls this module makes, by four-byte selector.
 *
 * Hard-coded rather than derived, because deriving them needs keccak256 and this file is
 * imported by three surfaces that should not have to carry a hashing library to read a
 * timestamp. `anchor.test.js` recomputes each one from its signature with viem and fails
 * if they drift, which is the check that matters — a wrong selector here would not throw,
 * it would read a different function's storage.
 */
export const SELECTORS = {
  // verifyReceipt(bytes6,bytes32) -> (uint8 status, uint64 anchoredAt, uint64 withdrawnAt)
  verifyReceipt: "0xcbed911e",
  // anchorOf(bytes6) -> (bytes32 codeHash, bytes32 modelHash, uint64 anchoredAt, uint64 withdrawnAt)
  anchorOf: "0xcfb85ec9",
  // latestAnchoredAt() -> uint64
  latestAnchoredAt: "0xe3b9bac1",
};

export class AnchorError extends Error {}

const RELEASE = /^r-([\da-f]{12})$/;

/** A release id as the contract's `bytes6`: left-aligned in a 32-byte word. */
export function releaseWord(release) {
  const matched = RELEASE.exec(String(release || "").toLowerCase());
  if (!matched) throw new AnchorError(`Not a release id: ${String(release)}`);
  return matched[1].padEnd(64, "0");
}

/**
 * A build's file hash as the contract's `bytes32`.
 *
 * The manifest and the registry both spell it the subresource-integrity way — sha256- and
 * base64 — because that is what a browser checks a script against. The chain holds the
 * same 32 bytes in hex. Converting here rather than at each call site is what keeps the
 * two spellings from being compared to each other by mistake.
 */
export function codeHashWord(filesHash) {
  const value = String(filesHash || "");
  if (!value) return "0".repeat(64);
  if (/^0x[\da-f]{64}$/i.test(value)) return value.slice(2).toLowerCase();
  const base64 = value.replace(/^sha256-/, "");
  let binary = "";
  try {
    binary = atob(base64);
  } catch {
    throw new AnchorError(`Not a sha256 file hash: ${value}`);
  }
  if (binary.length !== 32) throw new AnchorError(`Not a 32-byte file hash: ${value}`);
  let hex = "";
  for (let index = 0; index < binary.length; index += 1)
    hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
  return hex;
}

/**
 * `eth_call` data for the release a receipt names.
 *
 * `filesHash` is optional and usually absent: a receipt carries a release id and no hash,
 * so the ordinary question is only whether that build was published. A caller holding the
 * manifest passes the hash too and gets the stronger answer, where the contract can say
 * the id and the code disagree.
 */
export function verifyReceiptCall(release, filesHash = "") {
  return `${SELECTORS.verifyReceipt}${releaseWord(release)}${codeHashWord(filesHash)}`;
}

/** `eth_call` data for the timestamp of the most recent anchoring. */
export function latestAnchoredAtCall() {
  return SELECTORS.latestAnchoredAt;
}

const words = (result) => {
  const hex = String(result || "").replace(/^0x/, "");
  if (hex.length % 64 !== 0) throw new AnchorError("The chain returned a malformed response.");
  return hex.match(/.{64}/g) || [];
};

const number = (word) => {
  const value = BigInt(`0x${word}`);
  // Seconds since 1970 in a uint64. Anything that does not fit a JS integer is not a
  // timestamp, and turning it into one silently is how a nonsense reply becomes a date.
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new AnchorError("Timestamp out of range.");
  return Number(value);
};

/** Read `verifyReceipt`'s three return values. */
export function decodeVerifyReceipt(result) {
  const [status, anchoredAt, withdrawnAt] = words(result);
  if (withdrawnAt === undefined) throw new AnchorError("The chain returned a short response.");
  const code = number(status);
  if (!(code in STATUS_NAMES)) throw new AnchorError(`Unknown anchor status: ${code}`);
  return { status: code, anchoredAt: number(anchoredAt), withdrawnAt: number(withdrawnAt) };
}

/** Read `latestAnchoredAt`'s single return value. */
export function decodeLatestAnchoredAt(result) {
  const [value] = words(result);
  if (value === undefined) throw new AnchorError("The chain returned a short response.");
  return number(value);
}

const iso = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : "");
const day = (seconds) => iso(seconds).slice(0, 10) || "an unrecorded date";

/**
 * Read an anchor into the receipt check.
 *
 * `anchor` is whatever the caller got back from the chain, already decoded, or null when
 * nothing could be read. `latestAnchoredAt` is the timestamp of the most recent anchoring,
 * which is what separates the two reasons a release can be absent — the same distinction
 * `registry.js` draws between a stale list and a forged release, and the same answer: when
 * the record has not caught up to the receipt, absence establishes nothing.
 */
export function anchorCheck(receipt, anchor, { origin = FROM_PAGE, latestAnchoredAt = 0 } = {}) {
  const row = (status, detail) => ({ id: "anchor", label: "On-chain anchor", status, detail });
  const release = receipt?.release || "";

  if (!release) return row(SKIPPED, "No release was recorded in this receipt.");
  if (!anchor)
    return row(
      SKIPPED,
      "No chain was read. The release above is checked against the registry file only, which Tera serves and can rewrite. Run the command-line verifier with an RPC endpoint you chose to check it against the anchor instead.",
    );

  // Both directions of this one are definite, and neither depends on who asked. A page
  // willing to misreport its release does not volunteer that the chain disagrees with it,
  // so an admission against interest is worth the same from either origin.
  if (anchor.status === MISMATCH)
    return row(
      FAIL,
      `${release} is anchored, but against a different build than the one this receipt's file hash names. The id and the code it claims do not belong together.`,
    );

  if (anchor.status === WITHDRAWN) {
    const written = Date.parse(receipt?.at || "");
    const after =
      Number.isFinite(written) && anchor.withdrawnAt && written > anchor.withdrawnAt * 1000;
    return row(
      FAIL,
      `${release} was anchored on ${day(anchor.anchoredAt)} and withdrawn on ${day(anchor.withdrawnAt)}. ${
        after
          ? "This receipt was written afterwards, by a build Tera had already taken back."
          : "This receipt was written before the withdrawal, so it names a build that was published at the time — but it is not one Tera stands behind now."
      } The withdrawal reason is on chain, in the event that proposed it.`,
    );
  }

  if (anchor.status === UNKNOWN) {
    const written = Date.parse(receipt?.at || "");
    const caught = latestAnchoredAt * 1000;
    if (!Number.isFinite(written) || !caught)
      return row(
        UNVERIFIABLE,
        `${release} is not anchored, and the two dates needed to tell a record that has not caught up from a build that was never published could not be read. Absence alone establishes neither.`,
      );
    if (written > caught)
      return row(
        UNVERIFIABLE,
        `${release} is not anchored, but the most recent anchoring was ${day(latestAnchoredAt)} and this receipt was written afterwards, on ${receipt.at}. A record older than the receipt cannot say whether the build was published.`,
      );
    if (origin !== INDEPENDENT)
      return row(
        UNVERIFIABLE,
        `${release} is not in the anchor, and this page chose the endpoint it asked. Absence reported by the page being asked about is not evidence. Check it from the command-line verifier against an endpoint you chose.`,
      );
    return row(
      FAIL,
      `This receipt names ${release}, which was never anchored — and builds were anchored as recently as ${day(latestAnchoredAt)}, after this receipt was written. No such build was published.`,
    );
  }

  if (origin !== INDEPENDENT)
    return row(
      UNVERIFIABLE,
      `${release} is anchored on chain and not withdrawn, but this page read that itself, through an endpoint it chose. A page that would misreport its release can misreport what the chain said about it. Check it from outside the browser.`,
    );

  return row(
    PASS,
    `${release} was anchored on ${day(anchor.anchoredAt)} and has not been withdrawn. Anchored once, at a timestamp Tera cannot move — that establishes the build was published and that the record of it has not been rewritten since. It does not establish that the page which wrote this receipt was running it.`,
  );
}

/**
 * Gate zero: the check on the build, run before the checks on the action.
 *
 * The five service gates evaluate a transaction. This one evaluates the wallet that is
 * about to prepare it, and it runs first because a build Tera has withdrawn should not be
 * assembling proposals whatever the service thinks of them.
 *
 * It does not follow `blockers()` in `verdict.js`, and the difference is deliberate enough
 * to spell out. There, an unproven gate stops the action, because "we could not establish
 * that this transfer is permitted" is not a state to act in. Here, unproven means this
 * page could not reach a chain — and refusing to prepare anything on that would give an
 * unreachable endpoint the power to stop a wallet working, in exchange for protecting
 * nobody: a modified build does not run this check at all. So only a definite negative
 * blocks, and the honest case it is actually for — a cached build that has since been
 * withdrawn, which is the one where the owner has no other way to find out — is definite.
 */
export function buildGate(anchor, { origin = FROM_PAGE, release = "", latestAnchoredAt = 0 } = {}) {
  const check = anchorCheck({ release, at: new Date().toISOString() }, anchor, {
    origin,
    latestAnchoredAt,
  });
  // The two "nothing happened" cases read differently here than they do on a receipt. A
  // receipt is being examined by someone holding a file; this is a wallet reporting on
  // itself before it prepares anything, and the sentence it owes the owner is what it
  // did not manage to do, not what they could do about it later.
  const detail = !release
    ? "This page has not established which release it is running, so there was nothing to look up."
    : !anchor
      ? "The build anchor could not be read. Nothing here establishes that this build was published, and nothing here says it was not."
      : check.detail;
  return {
    gate: GATE_ZERO,
    status: check.status,
    detail,
    // Only a definite negative stops the wallet. See above.
    blocking: check.status === FAIL,
  };
}

/** What the anchor does not establish, for the panel that offers it. */
export const LIMITS = [
  "It records which builds were published and when, where the record cannot be changed quietly. It does not establish that the page which wrote a receipt was running one of them.",
  "Read from inside the wallet it is not a second opinion: this page chose the endpoint it asked, exactly as it chose the registry it fetched. The command-line verifier, pointed at an endpoint you chose, is where a match means something.",
  "A release absent from a record that has not caught up to the receipt means the anchoring is behind, not that the build was forged. The contract publishes when it was last written to, so the two can be told apart.",
  "Anchoring is owned by a key Tera holds. What it stops is a rewrite going unnoticed — a release is anchored once, withdrawal is announced days before it takes effect, and nothing is ever deleted. It does not stop Tera anchoring what it likes in the first place.",
];
