// Haptics: one distinct feel for each thing the owner needs to notice. No
// UI of its own; android/src/haptics.ts plays a pattern through
// expo-haptics (which uses navigator.vibrate on the web where it exists).
//
// The rules, each one a test:
//
//   Five events, five patterns, no two alike: a tap (light), a signature
//   (heavy), success (the system's success), an error (the system's error)
//   and a lookalike address (the system's warning followed by two heavy
//   knocks). The lookalike is the longest by design: it is the one that
//   must not be mistaken for anything routine.
//
//   The same event twice within 400 ms plays once: a notice and the action
//   that raised it never double-buzz. A lookalike is never swallowed this
//   way, whatever played just before it.
//
//   Vibrations off in Settings means nothing plays, the lookalike included:
//   the warning is also on screen, and the owner said no.

export const EVENTS = ["tap", "confirm", "success", "error", "lookalike"];

export const PATTERNS = {
  tap: [{ impact: "light" }],
  confirm: [{ impact: "heavy" }],
  success: [{ notification: "success" }],
  error: [{ notification: "error" }],
  lookalike: [{ notification: "warning" }, { wait: 180 }, { impact: "heavy" }, { wait: 120 }, { impact: "heavy" }],
};

export const REPEAT_MS = 400;

/** The steps to play for `event`, or [] for none. last: { event, at } of the previous play. */
export function plan(event, { enabled = true, now = Date.now(), last = null } = {}) {
  if (!enabled || !PATTERNS[event]) return [];
  if (event !== "lookalike" && last && last.event === event && now - last.at < REPEAT_MS) return [];
  return PATTERNS[event];
}

/** The haptic event a notice's tone calls for. */
export function forTone(tone) {
  return tone === "error" ? "error" : tone === "success" ? "success" : tone === "lookalike" ? "lookalike" : null;
}
