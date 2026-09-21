import { test } from "node:test";
import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";
import {
  FROM_PAGE,
  INDEPENDENT,
  PASS,
  FAIL,
  UNVERIFIABLE,
  SKIPPED,
  UNKNOWN,
  ANCHORED,
  MISMATCH,
  WITHDRAWN,
  GATE_ZERO,
  SELECTORS,
  AnchorError,
  releaseWord,
  codeHashWord,
  verifyReceiptCall,
  latestAnchoredAtCall,
  decodeVerifyReceipt,
  decodeLatestAnchoredAt,
  anchorCheck,
  buildGate,
} from "../../public/tera/core/anchor.js";

const RELEASE = "r-84b83f4cdd75";
const seconds = (iso) => Math.floor(Date.parse(iso) / 1000);

const ANCHORED_AT = seconds("2026-09-01T00:00:00.000Z");
const LATEST = seconds("2026-09-19T00:00:00.000Z");

const receipt = (at, release = RELEASE) => ({ release, at });
const anchor = (status, extra = {}) => ({
  status,
  anchoredAt: ANCHORED_AT,
  withdrawnAt: 0,
  ...extra,
});

// The one thing in this module that cannot be checked by reading it. A wrong selector
// does not throw: it calls a different function, or none, and the wallet reports whatever
// comes back. Recomputed here from the signature rather than copied from the constant.
test("the selectors are the ones the contract's signatures produce", () => {
  assert.equal(SELECTORS.verifyReceipt, toFunctionSelector("verifyReceipt(bytes6,bytes32)"));
  assert.equal(SELECTORS.anchorOf, toFunctionSelector("anchorOf(bytes6)"));
  assert.equal(SELECTORS.latestAnchoredAt, toFunctionSelector("latestAnchoredAt()"));
});

test("a release id encodes as bytes6, left-aligned", () => {
  assert.equal(releaseWord(RELEASE), `84b83f4cdd75${"0".repeat(52)}`);
  assert.throws(() => releaseWord("84b83f4cdd75"), AnchorError);
  assert.throws(() => releaseWord("r-84b83f4cdd7"), AnchorError);
});

test("a subresource-integrity file hash encodes as the same 32 bytes in hex", () => {
  // The release id is the first six bytes of the build's file hash, which is what lets
  // the contract derive one from the other. If this conversion were wrong, that relation
  // would silently stop holding.
  const filesHash = "sha256-hLg/TN11UiuRb+xXPUbxRTK8pZSZN6QG93jnKqpiQZE=";
  assert.equal(codeHashWord(filesHash).slice(0, 12), "84b83f4cdd75");
  assert.equal(codeHashWord("").length, 64);
  assert.throws(() => codeHashWord("sha256-tooshort"), AnchorError);
});

test("a call carries the release and, when given, the file hash", () => {
  const data = verifyReceiptCall(RELEASE, "sha256-hLg/TN11UiuRb+xXPUbxRTK8pZSZN6QG93jnKqpiQZE=");
  assert.equal(data.slice(0, 10), SELECTORS.verifyReceipt);
  assert.equal(data.length, 10 + 128);
  // Without a hash the second word is zero, which is the contract's "ask about
  // publication alone" and not a hash that happens to be empty.
  assert.equal(verifyReceiptCall(RELEASE).slice(-64), "0".repeat(64));
  assert.equal(latestAnchoredAtCall(), SELECTORS.latestAnchoredAt);
});

test("a malformed or short reply is an error, never a timestamp", () => {
  assert.throws(() => decodeVerifyReceipt("0x1234"), AnchorError);
  assert.throws(() => decodeVerifyReceipt(`0x${"0".repeat(128)}`), AnchorError);
  assert.throws(() => decodeVerifyReceipt(`0x${"f".repeat(192)}`), AnchorError);
  assert.equal(decodeLatestAnchoredAt(`0x${LATEST.toString(16).padStart(64, "0")}`), LATEST);
});

test("a reply decodes into the contract's three values", () => {
  const word = (value) => value.toString(16).padStart(64, "0");
  const result = `0x${word(ANCHORED)}${word(ANCHORED_AT)}${word(0)}`;
  assert.deepEqual(decodeVerifyReceipt(result), {
    status: ANCHORED,
    anchoredAt: ANCHORED_AT,
    withdrawnAt: 0,
  });
});

test("an anchored release read independently is the only pass", () => {
  const result = anchorCheck(receipt("2026-09-10T00:00:00.000Z"), anchor(ANCHORED), {
    origin: INDEPENDENT,
    latestAnchoredAt: LATEST,
  });
  assert.equal(result.status, PASS);
  assert.match(result.detail, /does not establish that the page/i);
});

test("an anchored release read by the page it describes is not a second opinion", () => {
  const result = anchorCheck(receipt("2026-09-10T00:00:00.000Z"), anchor(ANCHORED), {
    origin: FROM_PAGE,
    latestAnchoredAt: LATEST,
  });
  assert.equal(result.status, UNVERIFIABLE);
  assert.match(result.detail, /endpoint it chose/i);
});

test("a release absent from an anchor that has caught up was never published", () => {
  const result = anchorCheck(receipt("2026-09-10T00:00:00.000Z"), anchor(UNKNOWN), {
    origin: INDEPENDENT,
    latestAnchoredAt: LATEST,
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /never anchored/i);
});

test("a release absent from an anchor written before the receipt proves nothing", () => {
  // The same trap `registry.js` closed for a stale registry file. Anchoring that has not
  // caught up must not read as the strongest accusation this system makes.
  const result = anchorCheck(receipt("2026-09-20T00:00:00.000Z"), anchor(UNKNOWN), {
    origin: INDEPENDENT,
    latestAnchoredAt: LATEST,
  });
  assert.equal(result.status, UNVERIFIABLE);
  assert.match(result.detail, /cannot say whether the build was published/i);
});

test("absence reported by the page being asked about is not evidence", () => {
  const result = anchorCheck(receipt("2026-09-10T00:00:00.000Z"), anchor(UNKNOWN), {
    origin: FROM_PAGE,
    latestAnchoredAt: LATEST,
  });
  assert.equal(result.status, UNVERIFIABLE);
});

test("a mismatch fails from either origin, because no page volunteers one", () => {
  for (const origin of [FROM_PAGE, INDEPENDENT]) {
    const result = anchorCheck(receipt("2026-09-10T00:00:00.000Z"), anchor(MISMATCH), {
      origin,
      latestAnchoredAt: LATEST,
    });
    assert.equal(result.status, FAIL);
  }
});

test("a withdrawn build fails, and says whether the receipt predates the withdrawal", () => {
  const withdrawnAt = seconds("2026-09-15T00:00:00.000Z");
  const before = anchorCheck(
    receipt("2026-09-10T00:00:00.000Z"),
    anchor(WITHDRAWN, { withdrawnAt }),
    { origin: INDEPENDENT, latestAnchoredAt: LATEST },
  );
  assert.equal(before.status, FAIL);
  assert.match(before.detail, /written before the withdrawal/i);

  const after = anchorCheck(
    receipt("2026-09-18T00:00:00.000Z"),
    anchor(WITHDRAWN, { withdrawnAt }),
    { origin: INDEPENDENT, latestAnchoredAt: LATEST },
  );
  assert.equal(after.status, FAIL);
  assert.match(after.detail, /already taken back/i);
});

test("no chain read and no release are both reported, never passed", () => {
  assert.equal(anchorCheck(receipt("2026-09-10T00:00:00.000Z"), null).status, SKIPPED);
  assert.equal(anchorCheck({ at: "2026-09-10T00:00:00.000Z" }, anchor(ANCHORED)).status, SKIPPED);
});

test("gate zero blocks on a withdrawn build and on nothing else", () => {
  const withdrawn = buildGate(anchor(WITHDRAWN, { withdrawnAt: LATEST }), {
    release: RELEASE,
    latestAnchoredAt: LATEST,
  });
  assert.equal(withdrawn.gate, GATE_ZERO);
  assert.equal(withdrawn.status, FAIL);
  assert.equal(withdrawn.blocking, true);

  // An unreachable chain must not be able to stop a wallet working. It reports what it
  // could not do and lets the owner carry on.
  const unread = buildGate(null, { release: RELEASE, latestAnchoredAt: LATEST });
  assert.equal(unread.status, SKIPPED);
  assert.equal(unread.blocking, false);
  assert.match(unread.detail, /could not be read/i);

  const anchoredFromPage = buildGate(anchor(ANCHORED), {
    release: RELEASE,
    latestAnchoredAt: LATEST,
  });
  assert.equal(anchoredFromPage.status, UNVERIFIABLE);
  assert.equal(anchoredFromPage.blocking, false);
});

test("gate zero before the release is known reports that, rather than a pass", () => {
  const gate = buildGate(null, { release: "", latestAnchoredAt: 0 });
  assert.equal(gate.status, SKIPPED);
  assert.equal(gate.blocking, false);
  assert.match(gate.detail, /which release it is running/i);
});
