// The security checkup: one score for how well this wallet is protected, and
// what to fix. No storage or network access of its own; android/App.tsx
// gathers the settings and the approval scan and draws the screen.
//
// The rules, each one a test:
//
//   Each check passes, fails, or is unknown. Unknown checks (approvals not
//   scanned yet or not available here, a backup Tera has no way to verify)
//   are listed but left out of the score, so the score never counts
//   something the wallet hasn't actually looked at, either way.
//
//   The score is the weight of passing checks over the weight of known
//   checks, out of 100. Weights follow what each one protects against:
//
//     backup     30  recovery phrase checked in the last 90 days
//     autolock   20  locks itself after 15 minutes or less
//     approvals  20  no unlimited token or whole-collection approvals open
//     limits     15  a spending limit is set
//     trusted    10  payments only to saved contacts
//     cover       5  hidden in the app switcher
//
//   Failing checks come first, heaviest first, so the top of the list is
//   always the fix worth the most.

import { DAY, INTERVAL_DAYS } from "./phrase-check.js";
import { isUnlimited } from "./approvals.js";
import { hasAny } from "./limits.js";

export const WEIGHTS = { backup: 30, autolock: 20, approvals: 20, limits: 15, trusted: 10, cover: 5 };
export const MAX_LOCK_MINUTES = 15;

/** Open approvals that can take everything: unlimited tokens or a whole collection. */
export const riskyGrants = (grants) =>
  (grants || []).filter((g) => g.kind === "collection" || isUnlimited(g.amount ?? 0n));

/**
 * The checks for one wallet.
 *
 * input: { hasPhrase, phraseRecord, autoLockMinutes, limits, trustedOnlyMode,
 *          coverAway, grants (null = not scanned), approvalsAvailable, now }
 * Each check: { id, weight, ok: true | false | null, count? }.
 */
export function checks(input) {
  const now = input.now ?? Date.now();
  const lock = input.autoLockMinutes ?? 15;
  const at = input.phraseRecord?.at;
  const risky = input.grants ? riskyGrants(input.grants).length : 0;
  const list = [
    { id: "backup", ok: input.hasPhrase ? !!at && now - at < INTERVAL_DAYS * DAY : null },
    { id: "autolock", ok: lock > 0 && lock <= MAX_LOCK_MINUTES },
    {
      id: "approvals",
      ok: input.approvalsAvailable && input.grants ? risky === 0 : null,
      count: risky,
    },
    { id: "limits", ok: hasAny(input.limits) },
    { id: "trusted", ok: !!input.trustedOnlyMode },
    { id: "cover", ok: input.coverAway !== false },
  ];
  return list.map((check) => ({ ...check, weight: WEIGHTS[check.id] }));
}

/** Out of 100, over known checks only; null if nothing is known. */
export function score(list) {
  const known = list.filter((c) => c.ok !== null);
  const total = known.reduce((sum, c) => sum + c.weight, 0);
  if (!total) return null;
  return Math.round((100 * known.filter((c) => c.ok).reduce((sum, c) => sum + c.weight, 0)) / total);
}

/** "strong" from 90, "fair" from 60, otherwise "weak". */
export const grade = (value) => (value === null ? null : value >= 90 ? "strong" : value >= 60 ? "fair" : "weak");

/** Failing first (heaviest first), then unknown, then passing; stable within each. */
export function ordered(list) {
  const rank = (c) => (c.ok === false ? 0 : c.ok === null ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || (a.ok === false ? b.weight - a.weight : 0));
}
