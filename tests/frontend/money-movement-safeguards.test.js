import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const appSource = readFileSync(join(root, "android/App.tsx"), "utf8");

// Every function that moves value to an address the owner typed or picked --
// not a swap, not funding the owner's own spend balance -- has to check
// trustedOnlyMode before it builds anything, or "Trusted only mode" (which
// Settings states without qualification: "Transfers restricted to saved
// contacts") silently does not apply to it. A send, a private send, a
// bridge, a private bridge, an NFT send and a dollar payment all reach a
// recipient the owner chose; this list is every one of those paths as of
// this test. A new one belongs in this list the same day it's written.
const MONEY_MOVEMENT_FUNCTIONS = [
  "proposeTransfer",
  "prepareBatch",
  "preparePayment",
  "preparePrivateSend",
  "preparePrivateBridge",
  "prepareBridge",
  "sendNft",
];

function functionBody(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in App.tsx`);
  // Up to the next sibling top-level handler (2-space indent), or a generous
  // cutoff -- not a real parser, just enough to isolate one function's body
  // from the next without tripping over nested arrow functions (indented
  // further) inside it.
  const candidates = [
    appSource.indexOf("\n  async function ", start + 1),
    appSource.indexOf("\n  function ", start + 1),
  ].filter((n) => n > start);
  const end = candidates.length ? Math.min(...candidates) : start + 5000;
  return appSource.slice(start, end);
}

test("every money-movement path checks trusted-only mode before it builds a transfer", () => {
  for (const name of MONEY_MOVEMENT_FUNCTIONS) {
    assert.match(
      functionBody(name),
      /trustedOnlyMode/,
      `${name} doesn't check trustedOnlyMode -- "Trusted only mode" would silently not restrict it`,
    );
  }
});

// Same shape of gap, different setting: a per-payment/daily/monthly spending
// limit the owner set has to be checked everywhere a dollar-denominated
// amount leaves the wallet, or the limit is fiction past the paths that
// remember to call enforceLimits(). sendNft is deliberately not in this list
// -- an NFT send has no dollar amount computed anywhere in that function
// (floor price isn't what a specific NFT is worth), so there is nothing
// honest to check it against yet.
const SPENDING_LIMIT_FUNCTIONS = [
  "proposeTransfer",
  "prepareBatch",
  "preparePayment",
  "preparePrivateSend",
  "preparePrivateBridge",
  "prepareBridge",
];

test("every dollar-denominated money-movement path enforces the owner's spending limit", () => {
  for (const name of SPENDING_LIMIT_FUNCTIONS) {
    assert.match(
      functionBody(name),
      /enforceLimits\(/,
      `${name} doesn't call enforceLimits() -- a per-payment/daily/monthly spending limit would silently not apply to it`,
    );
  }
});
