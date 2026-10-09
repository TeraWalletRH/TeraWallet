import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_FOR_ALL_TOPIC,
  APPROVAL_TOPIC,
  UNLIMITED_FROM,
  checkRevoke,
  isUnlimited,
  latestGrants,
  openGrants,
  ownerTopic,
  revokeCall,
  scanRanges,
  spenderName,
} from "../../public/tera/core/approvals.js";

const owner = `0x${"1".repeat(40)}`;
const other = `0x${"9".repeat(40)}`;
const usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const router = "0xcaf681a66d020601342297493863e78c959e5cb2";
const nfts = `0x${"c".repeat(40)}`;
const pad = (hex) => `0x${hex.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
const MAX = 2n ** 256n - 1n;
const log = (topic, token, from, spender, value, block, logIndex = 0) => ({
  address: token,
  topics: [topic, pad(from), pad(spender)],
  data: pad(value.toString(16)),
  blockNumber: `0x${block.toString(16)}`,
  logIndex: `0x${logIndex.toString(16)}`,
});

test("scan ranges cover every block once, within the search limit", () => {
  const ranges = scanRanges(25_000_000n, 10_000_000n);
  assert.deepEqual(ranges, [
    { fromBlock: 0n, toBlock: 9_999_999n },
    { fromBlock: 10_000_000n, toBlock: 19_999_999n },
    { fromBlock: 20_000_000n, toBlock: 25_000_000n },
  ]);
  assert.deepEqual(scanRanges(0n), [{ fromBlock: 0n, toBlock: 0n }]);
});

test("the owner topic is the owner's address as a 32-byte word", () => {
  assert.equal(ownerTopic(owner), pad(owner));
  assert.throws(() => ownerTopic("0x123"));
});

test("only the newest approval per token and spender counts", () => {
  const grants = latestGrants(
    [
      log(APPROVAL_TOPIC, usdg, owner, router, MAX, 100),
      log(APPROVAL_TOPIC, usdg, owner, router, 0n, 200),
      log(APPROVAL_TOPIC, usdg, owner, router, 5n, 200, 3),
    ],
    owner,
  );
  assert.equal(grants.length, 1);
  assert.equal(grants[0].amount, 5n);
  assert.equal(grants[0].spender, router);
  assert.equal(grants[0].token, usdg);
});

test("logs that are not this owner's ERC-20 or operator approvals are ignored", () => {
  const nftItem = { ...log(APPROVAL_TOPIC, nfts, owner, router, 0n, 5), topics: [APPROVAL_TOPIC, pad(owner), pad(router), pad("7")], data: "0x" };
  const grants = latestGrants(
    [log(APPROVAL_TOPIC, usdg, other, router, MAX, 1), nftItem, log(APPROVAL_FOR_ALL_TOPIC, nfts, owner, router, 1n, 9)],
    owner,
  );
  assert.equal(grants.length, 1);
  assert.equal(grants[0].kind, "collection");
  assert.equal(grants[0].approved, true);
});

test("the explorer's null-padded topics read the same as the node's", () => {
  const padded = { ...log(APPROVAL_TOPIC, usdg, owner, router, MAX, 7), topics: [APPROVAL_TOPIC, pad(owner), pad(router), null] };
  const grants = latestGrants([padded], owner);
  assert.equal(grants.length, 1);
  assert.equal(grants[0].amount, MAX);
});

test("open grants drop spent and revoked ones and put unlimited first", () => {
  const listed = openGrants([
    { kind: "token", token: usdg, spender: other, amount: 10n, block: 50n },
    { kind: "token", token: usdg, spender: router, amount: MAX, block: 10n },
    { kind: "token", token: usdg, spender: owner, amount: 0n, block: 90n },
    { kind: "collection", token: nfts, spender: router, approved: false, block: 99n },
  ]);
  assert.deepEqual(listed.map((g) => g.spender), [router, other]);
  assert.equal(isUnlimited(UNLIMITED_FROM), true);
  assert.equal(isUnlimited(UNLIMITED_FROM - 1n), false);
});

test("a revoke is exactly approve(spender, 0) or setApprovalForAll(operator, false)", () => {
  const token = revokeCall({ kind: "token", token: usdg, spender: router });
  assert.equal(token.to, usdg);
  assert.equal(token.data, `0x095ea7b3${pad(router).slice(2)}${"0".repeat(64)}`);
  assert.equal(token.value, "0");
  const collection = revokeCall({ kind: "collection", token: nfts, spender: router });
  assert.equal(collection.data, `0xa22cb465${pad(router).slice(2)}${"0".repeat(64)}`);
});

test("the revoke check refuses anything else", () => {
  const grant = { kind: "token", token: usdg, spender: router };
  const tx = revokeCall(grant);
  checkRevoke({ ...tx, to: usdg.toUpperCase().replace("0X", "0x") }, grant);
  assert.throws(() => checkRevoke({ ...tx, value: "1" }, grant));
  assert.throws(() => checkRevoke({ ...tx, to: other }, grant));
  assert.throws(() => checkRevoke({ ...tx, data: tx.data.replace(/0$/, "1") }, grant));
  assert.throws(() => checkRevoke({ ...tx, data: revokeCall({ ...grant, spender: other }).data }, grant));
});

test("spenders Tera uses are named, others are not", () => {
  const known = { [router.toUpperCase().replace("0X", "0x")]: "Tera swap router" };
  assert.equal(spenderName(router, known), "Tera swap router");
  assert.equal(spenderName(other, known), null);
});
