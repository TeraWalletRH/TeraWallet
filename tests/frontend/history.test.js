import { test } from "node:test";
import assert from "node:assert/strict";
import {
  snapshot,
  diffVersions,
  appendVersion,
  versionTrail,
  pruneVersions,
  formatAmount,
  decisionOf,
  MAX_VERSIONS,
} from "../../public/tera/wallet/history.js";
import { GATES } from "../../public/tera/wallet/core.js";

const owner = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const other = `0x${"9".repeat(40)}`;
const token = `0x${"3".repeat(40)}`;
const hash = `0x${"4".repeat(64)}`;
const usdg = { symbol: "USDG", decimals: 6, category: "stablecoin" };

function proposal({ amount = "2500000000", to = recipient, gates, ...rest } = {}) {
  const intent = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: token,
    recipient: to,
    actionType: "TRANSFER",
    amount,
  };
  return {
    intent,
    gates: gates || GATES.map((gate) => ({ gate, passed: true })),
    preparedTransaction: { to: token, chainId: 4663, actionHash: hash, intent },
    ...rest,
  };
}

const blockedGates = GATES.map((gate) => ({
  gate,
  passed: gate !== "policy_vault",
  reason: gate === "policy_vault" ? "Over the limit." : "",
}));

test("a snapshot keeps the comparable fields and drops the calldata", () => {
  const version = snapshot(proposal(), usdg, 1000);
  assert.equal(version.at, 1000);
  assert.equal(version.actionType, "TRANSFER");
  assert.equal(version.assetSymbol, "USDG");
  assert.equal(version.amount, "2500000000");
  assert.equal(version.recipient, recipient);
  assert.equal(version.decimals, 6);
  assert.equal(version.decision, "Awaiting owner approval");
  assert.equal(JSON.stringify(version).includes("a9059cbb"), false);
  assert.equal("data" in version, false);
});

test("the decision reflects what the checks concluded", () => {
  assert.equal(decisionOf(proposal()), "Awaiting owner approval");
  assert.equal(decisionOf(proposal({ gates: blockedGates })), "Blocked at Policy check");
  assert.equal(decisionOf(proposal({ txHash: hash })), "Submitted");
  assert.equal(decisionOf({ gates: [] }), "Checks incomplete");
});

test("lowering the amount past a limit shows the amount change and the flip to PASS", () => {
  const before = snapshot(proposal({ amount: "2500000000", gates: blockedGates }), usdg, 1000);
  const after = snapshot(proposal({ amount: "500000000" }), usdg, 2000);
  const changes = diffVersions(before, after);
  const byField = Object.fromEntries(changes.map((change) => [change.field, change]));

  assert.equal(byField.amount.from, "2500 USDG");
  assert.equal(byField.amount.to, "500 USDG");
  assert.equal(byField.amount.note, "Reduced");
  assert.equal(byField["gate:policy_vault"].from, "BLOCKED");
  assert.equal(byField["gate:policy_vault"].to, "PASS");
  assert.equal(byField["gate:policy_vault"].note, "Now passing");
  assert.equal(byField.decision.from, "Blocked at Policy check");
  assert.equal(byField.decision.to, "Awaiting owner approval");
});

test("a changed recipient is reported", () => {
  const changes = diffVersions(
    snapshot(proposal(), usdg, 1000),
    snapshot(proposal({ to: other }), usdg, 2000),
  );
  const change = changes.find((row) => row.field === "recipient");
  assert.equal(change.from, recipient);
  assert.equal(change.to, other);
});

test("a changed asset is reported, and case-only address changes are not", () => {
  const changed = diffVersions(
    snapshot(proposal(), usdg, 1000),
    snapshot(proposal(), { symbol: "SPCX", decimals: 18 }, 2000),
  );
  assert.ok(changed.some((row) => row.field === "asset"));
  const sameAsset = diffVersions(
    snapshot(proposal({ to: recipient.toLowerCase() }), usdg, 1000),
    snapshot(proposal({ to: recipient.toUpperCase().replace("0X", "0x") }), usdg, 2000),
  );
  assert.equal(
    sameAsset.some((row) => row.field === "recipient"),
    false,
  );
});

test("an expiry change is reported", () => {
  const before = snapshot(proposal({ expiresAt: 1000 }), usdg, 10);
  const after = snapshot(proposal({ expiresAt: 5000 }), usdg, 20);
  assert.ok(diffVersions(before, after).some((row) => row.field === "expiry"));
  assert.equal(diffVersions(before, before).length, 0);
});

test("identical versions produce no diff", () => {
  const version = snapshot(proposal(), usdg, 1000);
  assert.deepEqual(diffVersions(version, version), []);
  assert.deepEqual(diffVersions(null, version), []);
  assert.deepEqual(diffVersions(version, null), []);
});

test("history is capped and keeps the most recent versions", () => {
  let versions = [];
  for (let i = 0; i < MAX_VERSIONS + 5; i++)
    versions = appendVersion(versions, snapshot(proposal(), usdg, i));
  assert.equal(versions.length, MAX_VERSIONS);
  assert.equal(versions[versions.length - 1].at, MAX_VERSIONS + 4);
  assert.equal(versions[0].at, 5);
});

test("the trail runs newest first and labels the live proposal", () => {
  const stored = [
    snapshot(proposal({ amount: "1" }), usdg, 1),
    snapshot(proposal({ amount: "2" }), usdg, 2),
  ];
  const trail = versionTrail(stored, snapshot(proposal({ amount: "3" }), usdg, 3));
  assert.equal(trail.length, 3);
  assert.equal(trail[0].label, "Current");
  assert.equal(trail[0].version.at, 3);
  assert.equal(trail[2].label, "Version 1");
  // The oldest version has nothing to compare against.
  assert.deepEqual(trail[2].changes, []);
  assert.ok(trail[0].changes.some((change) => change.field === "amount"));
});

test("retention drops versions past the window and keeps the rest", () => {
  const now = 100 * 86400000;
  const store = {
    recent: [snapshot(proposal(), usdg, now - 86400000)],
    stale: [snapshot(proposal(), usdg, now - 60 * 86400000)],
    mixed: [
      snapshot(proposal(), usdg, now - 60 * 86400000),
      snapshot(proposal(), usdg, now - 2 * 86400000),
    ],
  };
  const kept = pruneVersions(store, 30, now);
  assert.deepEqual(Object.keys(kept).sort(), ["mixed", "recent"]);
  assert.equal(kept.mixed.length, 1);
  assert.deepEqual(pruneVersions(null, 30, now), {});
});

test("amounts render with the asset precision, or raw when it is unknown", () => {
  assert.equal(formatAmount(snapshot(proposal(), usdg, 1)), "2500 USDG");
  assert.equal(formatAmount(snapshot(proposal(), null, 1)), "2500000000");
  assert.equal(formatAmount({ amount: "" }), "—");
});
