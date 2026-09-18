// The offline verifier's logic, bundled into one file with no imports left.
//
// It imports the wallet's own modules rather than reimplementing them. A
// verifier that computes verification a second way eventually computes it
// differently, and on the day the two disagree you have two answers and no way
// to tell which is the bug.
//
// Bundled rather than concatenated by hand: `receipt.js` and `verdict.js` both
// define the four state constants, so pasting them into one scope is a
// redeclaration. Rollup renames them; a build script guessing at that would be
// one rename away from shipping a page that throws on open, with the network
// off and nobody watching a console.

import { verify, INDEPENDENT } from "../../public/tera/core/receipt.js";
import { parseRegistry, verifyRegistry } from "../../public/tera/core/registry.js";
import { headline, rows, claims } from "../../public/tera/core/report.js";
import { recoverMessageAddress } from "viem";

const recover = (message, signature) => recoverMessageAddress({ message, signature });

/**
 * Check one receipt file's text.
 *
 * `recover` is handed in exactly as the wallet hands it in. Without it the
 * signature check reports unproven, which is the honest state and not a pass.
 */
export async function check(raw, registryText = "", expectedSigner = "") {
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* `verify` reports an unreadable file as a failed format check, which is a
       better message than anything repeated here. */
  }

  // An approved-build registry, if the reader brought one. This page is the
  // place where bringing one matters: it runs off a file on your machine,
  // against a list you fetched yourself, so a release that is absent from it is
  // evidence rather than a curiosity. The wallet checking its own copy is not.
  let registry = null;
  let registryAuthentic = false;
  let registryNote = "";
  if (registryText) {
    try {
      registry = parseRegistry(registryText);
    } catch (error) {
      registryNote = `That registry could not be read: ${error.message}`;
    }
  }
  if (registry && expectedSigner) {
    const checked = await verifyRegistry(registry, { recover, expectedSigner });
    registryAuthentic = checked.ok;
    if (!checked.ok) registryNote = `The registry was not authenticated: ${checked.reason}`;
  } else if (registry) {
    registryNote =
      "The registry was read but not authenticated: give the signer address you expect. Until then the release check stays unproven.";
  }

  const result = await verify(raw, {
    recover,
    registry,
    registryOrigin: INDEPENDENT,
    registryAuthentic,
  });
  return {
    registryNote,
    summary: headline(result.checks || []),
    rows: rows(result.checks || []),
    claims: claims(parsed),
  };
}

globalThis.TeraVerify = { check };
