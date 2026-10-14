// The command palette (Cmd+K / Ctrl+K on the desktop web layout): one box
// to send, receive, swap, find a contact or jump to a token. No UI of its
// own; android/App.tsx builds the entries and draws the list.
//
// The rules, each one a test:
//
//   Matching ignores case and accents. A label that starts with the query
//   beats one with a word starting with it, which beats one containing it,
//   which beats one whose letters merely appear in order ("snd" finds Send).
//   Keywords (other words for the same thing) match one step below the label.
//   A single letter only matches the start of a word: it is in almost
//   everything otherwise.
//
//   With no query the list is the actions, in their own order: the palette
//   opens on what people do most, not on an arbitrary contact or token.
//
//   Ties keep the order the entries were given in, so results don't jump
//   around between keystrokes. At most `limit` results.
//
//   A pasted wallet address offers to send to it, even if no contact has it.

const fold = (text) =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

function subsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

/** How well `query` matches `text`: 4 prefix, 3 word start, 2 contains, 1 in order, 0 no. */
export function matchScore(query, text) {
  const q = fold(query);
  const t = fold(text);
  if (!q || !t) return 0;
  if (t.startsWith(q)) return 4;
  if (t.split(/[\s\-_/·.@]+/).some((word) => word.startsWith(q))) return 3;
  // One letter is in almost everything; it only counts at the start of a word.
  if (q.length < 2) return 0;
  if (t.includes(q)) return 2;
  if (subsequence(q, t.replace(/\s+/g, ""))) return 1;
  return 0;
}

/**
 * Entries ranked for `query`.
 * entry: { id, kind: "action" | "contact" | "token", label, detail?, keywords?: string[] }
 */
export function rank(entries, query, limit = 8) {
  const q = fold(query);
  if (!q) return entries.filter((e) => e.kind === "action").slice(0, limit);
  return entries
    .map((entry, index) => {
      const label = matchScore(q, entry.label);
      const others = Math.max(0, ...[entry.detail, ...(entry.keywords || [])].map((k) => matchScore(q, k)));
      // Label matches outrank keyword matches of the same strength.
      return { entry, index, score: label ? label * 2 : others ? others * 2 - 1 : 0 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.entry);
}

/** The address in `query` if it is one (0x and 40 hex), else "". */
export function pastedAddress(query) {
  const q = String(query ?? "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(q) ? q : "";
}

/** The next highlighted row for an arrow key, wrapping at both ends. */
export function move(index, count, step) {
  if (!count) return 0;
  return (((index + step) % count) + count) % count;
}
