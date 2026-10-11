import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY,
  MAX_TRIES,
  daysSince,
  isDue,
  matches,
  passed,
  pickPositions,
  reminders,
  snoozed,
} from "../../public/tera/core/phrase-check.js";

const NOW = Date.UTC(2026, 9, 11);
const PHRASE = "abandon ability able about above absent absorb abstract absurd abuse access accident";

test("due 90 days after the last passed check, not before", () => {
  assert.equal(isDue({ at: NOW - 89 * DAY }, NOW), false);
  assert.equal(isDue({ at: NOW - 90 * DAY }, NOW), true);
  assert.equal(daysSince({ at: NOW - 90 * DAY - 5 }, NOW), 90);
});

test("a wallet with no record is due now", () => {
  assert.equal(isDue(null, NOW), true);
  assert.equal(isDue({}, NOW), true);
  assert.equal(daysSince(null, NOW), null);
});

test("a passed check resets the clock and clears a snooze", () => {
  const record = passed(snoozed({ at: NOW - 200 * DAY }, NOW), NOW);
  assert.equal(record.at, NOW);
  assert.equal(record.snoozedUntil, undefined);
  assert.equal(isDue(record, NOW + 89 * DAY), false);
});

test("Later quiets the banner for 7 days, then it comes back", () => {
  const record = snoozed({ at: NOW - 100 * DAY }, NOW);
  assert.equal(isDue(record, NOW + 6 * DAY), false);
  assert.equal(isDue(record, NOW + 7 * DAY), true);
});

test("reminders can be turned off and back on", () => {
  const off = reminders({ at: NOW - 400 * DAY }, false);
  assert.equal(isDue(off, NOW), false);
  assert.equal(isDue(reminders(off, true), NOW), true);
});

test("three different positions, in order, varying between checks", () => {
  const seen = new Set();
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 50; i++) {
    const positions = pickPositions(12, random);
    assert.equal(positions.length, 3);
    assert.equal(new Set(positions).size, 3);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    assert.ok(positions.every((p) => p >= 0 && p < 12));
    seen.add(positions.join());
  }
  assert.ok(seen.size > 10);
  assert.throws(() => pickPositions(2));
});

test("answers must all match; case and spacing don't matter", () => {
  assert.equal(matches(PHRASE, [0, 5, 11], ["abandon", " Absent ", "ACCIDENT"]), true);
  assert.equal(matches(PHRASE, [0, 5, 11], ["abandon", "absent", "access"]), false);
  assert.equal(matches(PHRASE, [0, 5, 11], ["abandon", "absent"]), false);
  assert.equal(matches(PHRASE, [], []), false);
  assert.equal(matches(PHRASE, [12], ["anything"]), false);
  assert.equal(MAX_TRIES, 3);
});
