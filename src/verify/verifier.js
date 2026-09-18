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

import { verify } from "../../public/tera/core/receipt.js";
import { headline, rows, claims } from "../../public/tera/core/report.js";
import { recoverMessageAddress } from "viem";

const recover = (message, signature) => recoverMessageAddress({ message, signature });

/**
 * Check one receipt file's text.
 *
 * `recover` is handed in exactly as the wallet hands it in. Without it the
 * signature check reports unproven, which is the honest state and not a pass.
 */
export async function check(raw) {
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* `verify` reports an unreadable file as a failed format check, which is a
       better message than anything repeated here. */
  }
  const result = await verify(raw, { recover });
  return {
    summary: headline(result.checks || []),
    rows: rows(result.checks || []),
    claims: claims(parsed),
  };
}

globalThis.TeraVerify = { check };
