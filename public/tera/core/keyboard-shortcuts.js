// Single-key shortcuts on the web wallet: S to send, R to receive, / to
// search, ? for the cheat sheet, Esc to close or go back. No UI of its own;
// android/App.tsx listens for keys and draws the cheat sheet from SHORTCUTS.
//
// The rules, each one a test:
//
//   A key does nothing while the owner is typing: in a text field the
//   letters are text. Esc in a field belongs to the field too.
//
//   A key held with Cmd, Ctrl or Alt is the browser's or the system's
//   (Cmd+R reloads, Ctrl+S saves), never Tera's. Shift only counts where
//   it makes the key: "?" is Shift+/. Capital S and R work, for caps lock.
//   A held-down key fires once, not on every repeat.
//
//   Nothing fires over a transaction review, a PIN prompt, a shown secret
//   or work in progress: a stray S must never abandon a signature.
//
//   While a dialog is open the letters are left alone, and Esc is the
//   dialog's: it closes itself, and the page under it stays where it is.

export const SHORTCUTS = [
  { keys: ["S"], action: "send", label: "Send" },
  { keys: ["R"], action: "receive", label: "Receive" },
  { keys: ["/"], action: "search", label: "Search" },
  { keys: ["⌘K", "Ctrl K"], action: "palette", label: "Command palette" },
  { keys: ["?"], action: "help", label: "Show these shortcuts" },
  { keys: ["Esc"], action: "close", label: "Close a dialog or go back" },
];

const BY_KEY = { s: "send", r: "receive", "/": "search", "?": "help", escape: "close" };

/** Whether focus is somewhere keys are text: an input, a text area, a select or editable content. */
export function isTyping(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = String(target.type || "text").toLowerCase();
  return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"].includes(type);
}

/**
 * The action a key press asks for, or null.
 * event: { key, metaKey?, ctrlKey?, altKey?, shiftKey?, repeat?, target? }
 * state: { blocked?: boolean, dialogOpen?: boolean }
 */
export function shortcutFor(event, state = {}) {
  if (!event || typeof event.key !== "string") return null;
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return null;
  if (isTyping(event.target)) return null;
  if (state.blocked || state.dialogOpen) return null;
  const key = event.key.toLowerCase();
  // Shift+/ is "?" on most layouts; where it still reads "/", it isn't search.
  if (key === "/" && event.shiftKey) return null;
  return BY_KEY[key] || null;
}
