import { test } from "node:test";
import assert from "node:assert/strict";
import { claimKey, claimUrl, parseClaim, claimAmount, checkClaimTx } from "../../public/tera/core/claim-links.js";
const key = `0x${"1".repeat(64)}`;
const to = `0x${"2".repeat(40)}`;
test("bearer secrets round trip only in the fragment, including the native entry", () => {
  const url = claimUrl(key);
  assert.equal(parseClaim(url), key);
  assert.equal(new URL(url).search, "");
  assert.equal(parseClaim(`terawallet://claim${new URL(url).hash}`), key);
  assert.equal(url.split("#")[0], "https://terawallet.app/app/");
});
test("rejects zero/out-of-range keys, other hosts, chains, versions and query strings", () => {
  for (const bad of ["", null, "0x1", `0x${"0".repeat(64)}`, `0x${"f".repeat(64)}`]) assert.equal(claimKey(bad), null);
  const url = claimUrl(key);
  for (const bad of [url.replace("4663:", "1:"), url.replace("claim=1:", "claim=2:"),
    url.replace("terawallet.app", "evil.example"), url.replace("https:", "http:"),
    url.replace("/app/", "/other/"), url.replace("/app/", "/app/?tracking=1"),
    url.replace("terawallet.app", "user@terawallet.app"), `${url}&extra=1`, key]) assert.equal(parseClaim(bad), null);
});
test("fees come from the gift; no negative, dust, or excessive-fee claims", () => {
  assert.deepEqual(claimAmount(100000n, 21000n, 1n), { amount: 58000n, reserve: 42000n });
  assert.throws(() => claimAmount(0n, 21000n, 1n), /no claimable/);
  assert.throws(() => claimAmount(42000n, 21000n, 1n), /no claimable/);
  assert.throws(() => claimAmount(10n ** 18n, 21000n, 10n ** 12n), /fee exceeds/);
  assert.throws(() => claimAmount(100n, 0n, 1n));
});
test("bearer signing is restricted to a single native transfer to the receiving wallet", () => {
  const tx = { to, data: "0x", value: "58000", chainId: 4663 };
  assert.doesNotThrow(() => checkClaimTx([tx], to));
  for (const steps of [[], [tx, tx], [{ ...tx, to: `0x${"3".repeat(40)}` }],
    [{ ...tx, chainId: 1 }], [{ ...tx, data: "0xa9059cbb" }], [{ ...tx, value: "0" }], [{ ...tx, value: "-1" }]])
    assert.throws(() => checkClaimTx(steps, to));
});
