// "Updated 12s ago": how old the numbers on Home and Activity are. No UI of
// its own; android/App.tsx stamps each successful read and draws the label.
//
// The rules, each one a test:
//
//   Under 5 seconds is "just now". Then seconds, minutes, hours and days,
//   always rounded down: a stamp never claims to be fresher than it is.
//
//   Numbers count as stale after 90 seconds: the app re-reads every 25s
//   while open, so 90s means several reads in a row have not landed. A
//   stale stamp is shown as a warning, as is one whose last read failed,
//   so a wallet that has gone quiet never looks current.
//
//   Never read: no stamp at all, rather than "updated 56 years ago".
//
//   The label ticks every second for the first minute, then every 30s:
//   "4m ago" doesn't need redrawing every second.

export const JUST_NOW_MS = 5_000;
export const STALE_MS = 90_000;

/** How old `at` is at `now`: { unit: "now" | "s" | "m" | "h" | "d", n }, or null when never read. */
export function age(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return null;
  const ms = Math.max(0, now - at);
  if (ms < JUST_NOW_MS) return { unit: "now", n: 0 };
  const s = Math.floor(ms / 1000);
  if (s < 60) return { unit: "s", n: s };
  const m = Math.floor(s / 60);
  if (m < 60) return { unit: "m", n: m };
  const h = Math.floor(m / 60);
  if (h < 24) return { unit: "h", n: h };
  return { unit: "d", n: Math.floor(h / 24) };
}

/** "just now", "12s ago", "3m ago"…, or "" when never read. */
export function label(at, now = Date.now()) {
  const a = age(at, now);
  if (!a) return "";
  return a.unit === "now" ? "just now" : `${a.n}${a.unit} ago`;
}

/** Whether to warn: the last read failed, or the numbers are older than STALE_MS. */
export function stale(at, now = Date.now(), failed = false) {
  if (!Number.isFinite(at) || at <= 0) return !!failed;
  return !!failed || now - at > STALE_MS;
}

/** How long until the label next changes enough to redraw, in ms. */
export function tick(at, now = Date.now()) {
  return now - at < 60_000 ? 1_000 : 30_000;
}
