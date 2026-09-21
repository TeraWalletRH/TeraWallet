#!/usr/bin/env node
// Check a Tera receipt from the command line, away from the page that wrote it.
//
// The point of checking a receipt somewhere else is that the page which produced
// it is exactly the thing you cannot take at its word. A modified build reports
// whatever hashes it likes about itself; this reads the file with code you can
// diff against the published source, on a machine the page does not run on.
//
// It imports the wallet's own `receipt.js` rather than reimplementing the
// checks. A verifier that computes verification a second way eventually computes
// it differently, and the day it disagrees you have two answers and no way to
// tell which is the bug.
//
//   node scripts/verify-receipt.mjs path/to/tera-receipt-1a2b3c4d.json
//
// Exit codes: 0 every check passed, 1 a check failed, 2 nothing failed but
// something could not be established, 3 the file could not be read at all.

import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { argv, exit, stdout, stderr } from "node:process";
import { verify, INDEPENDENT } from "../public/tera/core/receipt.js";
import { parseRegistry, verifyRegistry } from "../public/tera/core/registry.js";
import { text, exitCode } from "../public/tera/core/report.js";

globalThis.crypto ??= webcrypto;

const USAGE = `Check a Tera receipt file.

  node scripts/verify-receipt.mjs <receipt.json> [--registry <file>] [--json] [--no-recover]

  --registry     An approved-build registry you fetched yourself, to check the
                 receipt's release against. Fetched by you and read here, this
                 is the one place a match means something — the wallet fetching
                 its own copy proves nothing about the page that wrote it.
                 A registry older than the receipt cannot say whether a release
                 was published, so absence from a stale copy reports as unproven
                 rather than as a forgery. Fetch a current one before reading
                 absence as evidence.
  --json         Print the raw result instead of a report.
  --no-recover   Skip signature recovery. The signature check then reports as
                 unproven, which is what it should say when nothing is able to
                 check it.

Exit codes: 0 all passed, 1 a check failed, 2 something is unproven, 3 unreadable.
`;

/**
 * Address recovery, loaded only if a signed receipt needs it.
 *
 * Imported lazily so that checking an unsigned receipt — the common case, and
 * the one someone runs on a machine with nothing installed — does not depend on
 * node_modules being present at all.
 */
async function loadRecover() {
  try {
    const { recoverMessageAddress } = await import("viem");
    return (message, signature) => recoverMessageAddress({ message, signature });
  } catch {
    return null;
  }
}

async function main() {
  const args = argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const registryAt = args.indexOf("--registry");
  const registryPath = registryAt >= 0 ? args[registryAt + 1] : "";
  const [path] = positional.filter((arg) => arg !== registryPath);

  if (!path || flags.has("--help") || flags.has("-h")) {
    stdout.write(USAGE);
    exit(path ? 0 : 3);
  }

  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    stderr.write(`Could not read ${path}: ${error.message}\n`);
    exit(3);
  }

  let receipt = {};
  try {
    receipt = JSON.parse(raw);
  } catch {
    /* `verify` reports an unreadable receipt as a failed format check, which is
       a better message than anything repeated here. */
  }

  const recover = flags.has("--no-recover") ? null : await loadRecover();
  if (receipt?.signature && !recover && !flags.has("--no-recover"))
    stderr.write(
      "This receipt is signed, but viem is not installed here, so the signature cannot be checked.\n" +
        "Run `bun install` in the repository, or pass --no-recover to say so explicitly.\n\n",
    );

  // The registry is read here, from a file the reader chose, which is what
  // makes the release check worth anything. A registry the page fetched for
  // itself is not a second opinion, and `registry.js` refuses to treat one as
  // though it were.
  let registry = null;
  let registryAuthentic = false;
  if (registryPath) {
    try {
      registry = parseRegistry(await readFile(registryPath, "utf8"));
    } catch (error) {
      stderr.write(`Could not read the registry at ${registryPath}: ${error.message}\n`);
      exit(3);
    }
    const signer = process.env.TERA_MANIFEST_SIGNER_ADDRESS;
    if (recover && signer) {
      const checked = await verifyRegistry(registry, { recover, expectedSigner: signer });
      registryAuthentic = checked.ok;
      if (!checked.ok)
        stderr.write(`The registry's signature did not check out: ${checked.reason}\n\n`);
    } else {
      stderr.write(
        "The registry was read but not authenticated: set TERA_MANIFEST_SIGNER_ADDRESS to the\n" +
          "expected signer. Until then the release check reports as unproven.\n\n",
      );
    }
  }

  // A registry older than the receipt is the common case for anyone who fetched
  // their copy once, and it is worth saying out loud rather than leaving the
  // reader to work out why a real build reports as unproven.
  if (registry && receipt?.at && Date.parse(receipt.at) > Date.parse(registry.publishedAt))
    stderr.write(
      `This registry was published ${registry.publishedAt}, before the receipt was written ` +
        `(${receipt.at}). A list older than the receipt cannot say whether its release was\n` +
        "published. Fetch a current registry for a conclusive answer.\n\n",
    );

  const result = await verify(raw, {
    ...(recover ? { recover } : {}),
    registry,
    registryOrigin: INDEPENDENT,
    registryAuthentic,
  });

  if (flags.has("--json")) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else stdout.write(`${text(result, receipt)}\n`);

  exit(exitCode(result));
}

await main();
