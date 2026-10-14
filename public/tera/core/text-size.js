// Larger text: one setting that makes every piece of text in the app bigger.
// No UI of its own; android/src/ui.tsx scales each Text and TextInput, and
// Settings offers the choices.
//
// The rules, each one a test:
//
//   Three sizes: Default, Large (+15%) and Larger (+30%). Unknown or missing
//   means Default, so older saved settings read as they always did.
//
//   A font size scales and rounds to a whole pixel, and so does its line
//   height, so lines never overlap. Sizes the app doesn't set are left to
//   the platform.
//
//   On phones the system's own text size still applies on top; together
//   they stop at twice the design size, past which fixed rows (the keypad,
//   the tab bar) can't hold a line.

export const SIZES = [
  { id: "default", scale: 1, label: "Default" },
  { id: "large", scale: 1.15, label: "Large" },
  { id: "larger", scale: 1.3, label: "Larger" },
];

export const MAX_TOTAL = 2;

/** A saved choice as one of the ids: unknown or missing is "default". */
export function current(id) {
  return SIZES.some((size) => size.id === id) ? id : "default";
}

/** The multiplier for a saved choice. */
export function scaleFor(id) {
  return SIZES.find((size) => size.id === id)?.scale ?? 1;
}

/** A style's fontSize and lineHeight at `scale`; other fields untouched. */
export function scaleStyle(style, scale) {
  if (!style || scale === 1) return null;
  const out = {};
  if (typeof style.fontSize === "number") out.fontSize = Math.round(style.fontSize * scale);
  if (typeof style.lineHeight === "number") out.lineHeight = Math.round(style.lineHeight * scale);
  return Object.keys(out).length ? out : null;
}

/** How far the system's own text size may scale on top: the total stops at MAX_TOTAL. */
export function systemAllowance(scale) {
  return Math.max(1, MAX_TOTAL / scale);
}

/** The choice after `id` in Settings, wrapping round. */
export function next(id) {
  const i = Math.max(0, SIZES.findIndex((size) => size.id === id));
  return SIZES[(i + 1) % SIZES.length].id;
}
