import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIXED_TERMS,
  activeEpoch,
  addPending,
  cleanPending,
  creditOutcome,
  creditRequest,
  depositIssue,
  fixedReward,
  flexibleApr,
  pendingFor,
  resolvePending,
} from "../../public/tera/core/staking.js";

const token = "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8";
const pool = "0x1F3249ADd6625e375245f114235c5ac9F59b6DdD";
const owner = `0x${"1".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;
const ONE = 10n ** 18n;
const transfer = (to, amount) =>
  `0xa9059cbb${to.toLowerCase().slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;

test("a fixed lock's reward is the service's own formula", () => {
  // 1,000 TERA for 90 days at 14%: 1000 × 1400 × 90 / 3,650,000 = 34.52… TERA.
  assert.equal(fixedReward(1000n * ONE, 90), (1000n * ONE * 1400n * 90n) / 3_650_000n);
  assert.equal(fixedReward(1000n * ONE, 30), (1000n * ONE * 600n * 30n) / 3_650_000n);
  assert.equal(fixedReward(1000n * ONE, 60), 0n);
  assert.equal(fixedReward(0n, 30), 0n);
  assert.deepEqual(Object.keys(FIXED_TERMS), ["30", "45", "90"]);
});

test("the flexible rate is this epoch's rewards over what is staked, diluted by the new stake", () => {
  const epoch = {
    status: "active",
    reward_rate_per_second: "1342920967888688",
    total_active_stake: "1076930000000000000001000",
  };
  const apr = flexibleApr(epoch);
  // ≈ 42,350 TERA a year over ≈ 1.077M staked ≈ 3.93%.
  assert.ok(Math.abs(apr - 3.9325) < 0.001, String(apr));
  assert.ok(flexibleApr(epoch, 1_000_000n * ONE) < apr / 1.9);
  assert.equal(flexibleApr({ ...epoch, status: "ended" }), null);
  assert.equal(flexibleApr({ ...epoch, total_active_stake: "0" }), null);
  assert.equal(flexibleApr(null), null);
});

test("new flexible stakes go into the active epoch that ends last", () => {
  const epochs = [
    { id: "a", status: "ended", ends_at: "2027-01-01T00:00:00Z" },
    { id: "b", status: "active", ends_at: "2026-11-01T00:00:00Z" },
    { id: "c", status: "active", ends_at: "2026-12-16T00:00:00Z" },
  ];
  assert.equal(activeEpoch(epochs).id, "c");
  assert.equal(activeEpoch([epochs[0]]), null);
});

test("a deposit is exactly TERA, to the pool, for the amount entered", () => {
  const amount = 250n * ONE;
  const tx = { to: token, data: transfer(pool, amount), value: "0x0", chainId: 4663 };
  const want = { token, pool, amount, chainId: 4663 };
  assert.equal(depositIssue(tx, want), "");
  assert.match(depositIssue({ ...tx, to: pool }, want), /not a TERA transfer/);
  assert.match(depositIssue({ ...tx, value: "0x1" }, want), /must not send ETH/);
  assert.match(depositIssue({ ...tx, chainId: 1 }, want), /different network/);
  assert.match(
    depositIssue({ ...tx, data: transfer(owner, amount) }, want),
    /exactly this amount to the staking pool/,
  );
  assert.match(
    depositIssue({ ...tx, data: transfer(pool, amount + 1n) }, want),
    /exactly this amount/,
  );
  assert.match(depositIssue(null, want), /did not return/);
});

test("pending deposits are remembered per wallet until credited", () => {
  let list = addPending([], {
    kind: "fixed",
    termDays: 90,
    txHash: hash,
    owner,
    amount: "1",
    at: 5,
  });
  list = addPending(list, {
    kind: "flexible",
    epochId: "e1",
    txHash: `0x${"b".repeat(64)}`,
    owner: `0x${"2".repeat(40)}`,
    amount: "1",
  });
  // The same hash twice is one deposit.
  list = addPending(list, {
    kind: "fixed",
    termDays: 90,
    txHash: hash.toUpperCase().replace("0X", "0x"),
    owner,
    amount: "1",
  });
  assert.equal(list.length, 2);
  assert.equal(pendingFor(list, owner).length, 1);
  assert.deepEqual(creditRequest(pendingFor(list, owner)[0]), {
    path: "/api/staking/locks",
    body: { walletAddress: owner, txHash: hash.toUpperCase().replace("0X", "0x"), termDays: 90 },
  });
  assert.deepEqual(
    creditRequest(list.find((e) => e.kind === "flexible")).path,
    "/api/staking/deposits",
  );
  list = resolvePending(list, hash);
  assert.equal(pendingFor(list, owner).length, 0);
  assert.deepEqual(
    cleanPending([
      { kind: "fixed", termDays: 60, txHash: hash, owner },
      { kind: "flexible", txHash: hash, owner },
      { kind: "other", txHash: hash, owner },
      null,
    ]),
    [],
  );
});

test("the service's answer is read as credited, waiting, or an error", () => {
  assert.equal(creditOutcome({ success: true, status: "awaiting_confirmations" }), "waiting");
  assert.equal(creditOutcome({ success: true, status: "credited" }), "credited");
  assert.equal(creditOutcome({ success: true, lock: {} }), "credited");
  assert.equal(creditOutcome({ success: false }), "error");
});
