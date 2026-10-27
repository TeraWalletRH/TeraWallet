// Setting up the extension: the rules behind its welcome pages. No storage or
// network access of its own; extension/src/welcome.ts draws the steps.
//
// The rules, each one a test:
//
//   A password is at least 8 characters, as the vault requires
//   (extension/src/vault.ts). Past that, the meter only advises: longer is
//   better, a mix of kinds of character helps a little, and a password made of
//   one character, a run like "12345678", or a word everyone tries is weak
//   whatever its length. The meter never blocks a password of 8 or more,
//   because the password only guards this one computer and the recovery
//   phrase is the real key.
//
//   A pasted recovery phrase fills the boxes in order, whatever separates the
//   words (spaces, new lines, commas, or the numbers a phrase is often written
//   with: "1. word 2. word"). Pasting more than 12 words switches to 24 boxes;
//   words past the last box are dropped.
//
//   Only 12 or 24 words. Those are the lengths Tera makes and the ones nearly
//   every wallet uses; the full check (the checksum) is crypto.ts's, so a box
//   can show a misspelt word as you type but only crypto.ts can say a phrase
//   is real.

export const MIN_PASSWORD = 8;
export const PHRASE_LENGTHS = [12, 24];

const COMMON = [
  "password",
  "passw0rd",
  "qwerty",
  "letmein",
  "welcome",
  "iloveyou",
  "admin",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "sunshine",
  "princess",
  "abc123",
  "tera",
  "terawallet",
  "wallet",
  "bitcoin",
  "ethereum",
  "crypto",
];

const RUNS = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** True when the text is one long run up or down a row: "12345678", "abcdefgh", "qwertyui". */
function isRun(text) {
  const lower = text.toLowerCase();
  return RUNS.some((run) => {
    const back = [...run].reverse().join("");
    return run.includes(lower) || back.includes(lower);
  });
}

/**
 * How strong a password reads. Returns { score: 0–4, label, ok }:
 * 0 "Too short" (refused), 1 "Weak", 2 "Fair", 3 "Strong", 4 "Very strong".
 */
export function passwordStrength(password) {
  const text = String(password ?? "");
  if (text.length < MIN_PASSWORD) return { score: 0, label: "Too short", ok: false };
  const lower = text.toLowerCase();
  const simple = lower.replace(/[^a-z]/g, "");
  const weak =
    new Set(text).size <= 2 ||
    isRun(text) ||
    COMMON.some(
      (word) => lower === word || simple === word || (word.length >= 5 && lower.startsWith(word)),
    );
  if (weak) return { score: 1, label: "Weak", ok: true };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(text)).length;
  let score = 1;
  if (text.length >= 12) score++;
  if (text.length >= 16) score++;
  if (kinds >= 3) score++;
  if (kinds <= 1 && text.length < 16) score = Math.min(score, 1);
  score = Math.min(4, Math.max(1, score));
  return { score, label: ["Too short", "Weak", "Fair", "Strong", "Very strong"][score], ok: true };
}

/** The words in pasted or typed text, lowercased, with list numbers and punctuation dropped. */
export function phraseWords(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((word) => word.replace(/^\d+[.):]?$/, "").replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

/** How many boxes a pasted phrase needs: 24 when it has more than 12 words, else the current count. */
export const boxesFor = (words, current = 12) => (words.length > 12 ? 24 : current);

/** The boxes after pasting `text` into box `at`: the words fill from there, in order. */
export function fillBoxes(boxes, at, text) {
  const words = phraseWords(text);
  const count = boxesFor(words, boxes.length);
  const next = Array.from({ length: count }, (_, i) => boxes[i] ?? "");
  words.forEach((word, i) => {
    if (at + i < count) next[at + i] = word;
  });
  return next;
}
