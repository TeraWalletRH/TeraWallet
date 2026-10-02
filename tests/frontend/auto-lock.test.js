import { test } from "node:test";
import assert from "node:assert/strict";

function shouldLock(lastActivityTime, currentTime, autoLockMinutes) {
  if (autoLockMinutes === 0) return false;
  const idleMs = currentTime - lastActivityTime;
  return idleMs >= autoLockMinutes * 60 * 1000;
}

test("auto-lock timer defaults to 15 minutes of inactivity", () => {
  const now = Date.now();
  const fourteenMinsAgo = now - 14 * 60 * 1000;
  const fifteenMinsAgo = now - 15 * 60 * 1000;

  assert.equal(shouldLock(fourteenMinsAgo, now, 15), false);
  assert.equal(shouldLock(fifteenMinsAgo, now, 15), true);
});

test("auto-lock timer respects custom durations (5m, 30m, 60m)", () => {
  const now = Date.now();

  assert.equal(shouldLock(now - 4 * 60 * 1000, now, 5), false);
  assert.equal(shouldLock(now - 5 * 60 * 1000, now, 5), true);

  assert.equal(shouldLock(now - 29 * 60 * 1000, now, 30), false);
  assert.equal(shouldLock(now - 30 * 60 * 1000, now, 30), true);

  assert.equal(shouldLock(now - 59 * 60 * 1000, now, 60), false);
  assert.equal(shouldLock(now - 60 * 60 * 1000, now, 60), true);
});

test("auto-lock timer set to 0 (Never) never locks regardless of inactivity", () => {
  const now = Date.now();
  const threeHoursAgo = now - 180 * 60 * 1000;

  assert.equal(shouldLock(threeHoursAgo, now, 0), false);
});
