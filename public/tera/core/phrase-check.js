// The recovery phrase re-check. No storage or network access of its own;
// android/App.tsx keeps the record (sealed, per wallet) and draws the quiz.
//
// A recovery phrase written down once and never looked at again can be lost,
// damaged or miscopied without anyone noticing, and the day it is needed is
// the day the phone is gone. So every 90 days the wallet asks for three of
// its words, which only works with the written copy in hand.
//
// The rules, each one a test:
//
//   Due 90 days after the last passed check. Creating or importing a wallet
//   counts as a check, since both mean typing or confirming the words. A
//   wallet with no record at all (made before this existed) is due now.
//
//   "Later" snoozes the reminder for 7 days; the reminder can also be turned
//   off. A snooze never extends past being due: it only quiets the banner.
//
//   The quiz asks for three different word positions, picked at random each
//   time, so it can't be passed by remembering last time's answers.
//
//   The answer is all or nothing. Saying which word was wrong would turn the
//   quiz into a way to recover the phrase a word at a time from an unlocked
//   phone without the PIN, so a wrong answer only says "doesn't match", and
//   after 3 wrong answers the quiz closes until the wallet is next unlocked.

export const DAY = 86400000;
export const INTERVAL_DAYS = 90;
export const SNOOZE_DAYS = 7;
export const MAX_TRIES = 3;

/** True when a check is due and the banner should show. */
export function isDue(record, now = Date.now()) {
  if (!record) return true;
  if (record.off) return false;
  if (record.snoozedUntil && now < record.snoozedUntil) return false;
  return !record.at || now - record.at >= INTERVAL_DAYS * DAY;
}

/** Whole days since the last passed check, or null if there has never been one. */
export function daysSince(record, now = Date.now()) {
  return record?.at ? Math.max(0, Math.floor((now - record.at) / DAY)) : null;
}

/** The record after a passed check. */
export const passed = (record, now = Date.now()) => ({ ...record, at: now, snoozedUntil: undefined });

/** The record after "Later". */
export const snoozed = (record, now = Date.now()) => ({ ...record, snoozedUntil: now + SNOOZE_DAYS * DAY });

/** The record with reminders on or off. */
export const reminders = (record, on) => ({ ...record, off: !on });

/**
 * Three different zero-based positions out of `count` words, in order.
 * `random` returns a float in [0, 1).
 */
export function pickPositions(count, random = Math.random, take = 3) {
  if (count < take) throw new Error("Not enough words to check.");
  const pool = Array.from({ length: count }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take).sort((a, b) => a - b);
}

const clean = (word) => String(word ?? "").trim().toLowerCase();

/** All or nothing: true only if every answer matches the word at its position. */
export function matches(phrase, positions, answers) {
  const words = clean(phrase).split(/\s+/);
  return (
    positions.length > 0 &&
    positions.length === answers.length &&
    positions.every((p, i) => words[p] !== undefined && clean(answers[i]) === words[p])
  );
}
