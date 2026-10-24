// Account avatars: a small picture the owner picks for one of their accounts.
//
// A wallet with several accounts (storage.ts's indices) shows them as a list
// of names and addresses, and two accounts with no name of their own read as
// "Wallet 2" and "Wallet 3" — easy to tell apart by reading, harder to tell
// apart at a glance while scanning the switcher. A picked avatar is for that
// glance. It is not an identity: it is never shown to a site, never part of
// what a transaction says, and never read by anything that decides what an
// address is allowed to do.
//
// Fixed presets rather than free upload, for the same reason a tag has a
// fixed charset (tags.js): a value this wallet stores and renders back to its
// owner is a value worth being able to say, exactly, what it can be. A photo
// or an arbitrary emoji would be one more thing to validate, store, and trust
// the source of, for a feature whose entire job is decoration.

/** What may be stored. Rendered as-is, so each is one grapheme. */
export const PRESETS = [
  "🦊",
  "🐙",
  "🦁",
  "🐢",
  "🦉",
  "🐬",
  "🦋",
  "🐝",
  "🌵",
  "🔥",
  "💎",
  "🌙",
];

/** Whether a value is one of the presets above. */
export function isPreset(value) {
  return PRESETS.includes(String(value ?? ""));
}
