import { test } from "node:test";
import assert from "node:assert/strict";
import { checks, grade, ordered, riskyGrants, score } from "../../public/tera/core/checkup.js";

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 12);
const all = {
  hasPhrase: true,
  phraseRecord: { at: NOW - 10 * DAY },
  autoLockMinutes: 5,
  limits: { perPayment: 500, daily: null, monthly: null },
  trustedOnlyMode: true,
  coverAway: true,
  grants: [],
  approvalsAvailable: true,
  now: NOW,
};
const byId = (list) => Object.fromEntries(list.map((c) => [c.id, c]));

test("everything on scores 100, strong", () => {
  const list = checks(all);
  assert.ok(list.every((c) => c.ok === true));
  assert.equal(score(list), 100);
  assert.equal(grade(score(list)), "strong");
});

test("a fresh wallet with defaults: auto-lock and cover pass, the rest fail", () => {
  const list = checks({ hasPhrase: true, phraseRecord: null, limits: undefined, grants: [], approvalsAvailable: true, now: NOW });
  const c = byId(list);
  assert.equal(c.autolock.ok, true); // default 15 minutes
  assert.equal(c.cover.ok, true); // absent means on
  assert.equal(c.backup.ok, false);
  assert.equal(c.limits.ok, false);
  assert.equal(c.trusted.ok, false);
  assert.equal(score(list), 45);
  assert.equal(grade(score(list)), "weak");
});

test("backup fails once the last check is 90 days old", () => {
  assert.equal(byId(checks({ ...all, phraseRecord: { at: NOW - 89 * DAY } })).backup.ok, true);
  assert.equal(byId(checks({ ...all, phraseRecord: { at: NOW - 90 * DAY } })).backup.ok, false);
});

test("auto-lock off or longer than 15 minutes fails", () => {
  assert.equal(byId(checks({ ...all, autoLockMinutes: 0 })).autolock.ok, false);
  assert.equal(byId(checks({ ...all, autoLockMinutes: 30 })).autolock.ok, false);
  assert.equal(byId(checks({ ...all, autoLockMinutes: 15 })).autolock.ok, true);
});

test("unlimited and whole-collection approvals fail; capped ones don't", () => {
  const grants = [
    { kind: "token", amount: 10n ** 6n },
    { kind: "token", amount: 2n ** 256n - 1n },
    { kind: "collection", approved: true },
  ];
  assert.equal(riskyGrants(grants).length, 2);
  const c = byId(checks({ ...all, grants }));
  assert.equal(c.approvals.ok, false);
  assert.equal(c.approvals.count, 2);
  assert.equal(byId(checks({ ...all, grants: [grants[0]] })).approvals.ok, true);
});

test("what wasn't checked is left out of the score, not counted either way", () => {
  const unscanned = checks({ ...all, grants: null });
  assert.equal(byId(unscanned).approvals.ok, null);
  assert.equal(score(unscanned), 100);
  const keyWallet = checks({ ...all, hasPhrase: false, trustedOnlyMode: false });
  assert.equal(byId(keyWallet).backup.ok, null);
  assert.equal(score(keyWallet), Math.round((100 * 60) / 70));
  assert.equal(byId(checks({ ...all, approvalsAvailable: false })).approvals.ok, null);
  assert.equal(score([{ id: "x", weight: 5, ok: null }]), null);
});

test("failing checks first, heaviest first, then unknown, then passing", () => {
  const list = checks({ ...all, trustedOnlyMode: false, autoLockMinutes: 0, grants: null, coverAway: false });
  assert.deepEqual(ordered(list).map((c) => c.id), ["autolock", "trusted", "cover", "approvals", "backup", "limits"]);
  assert.equal(grade(60), "fair");
  assert.equal(grade(89), "fair");
  assert.equal(grade(59), "weak");
});
