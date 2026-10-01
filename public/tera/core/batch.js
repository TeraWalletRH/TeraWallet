// Batch send: pay several people in one review.
//
// The owner pastes a list — or uploads a CSV — one payment per line:
//
//   0x5b27…9f05, 25
//   @mum, 10.50, rent share
//   pay@acme.com, 120, invoice 1042        (Tera Business, where emails resolve)
//
// This module reads that list and says, line by line, what it will pay and what
// is wrong with it. Nothing is guessed: a line that cannot be read is an error
// with its line number, never skipped, so the owner never pays a list that is
// shorter than the one they wrote.
//
// The payments are signed in one review and sent one after another, each its
// own transaction and its own row in Activity. They are not atomic: if one
// fails, the ones after it are not sent, and the review says so up front.

export const LIMITS = { maxPayments: 50, maxNote: 140 };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TAG = /^@?[a-z0-9][a-z0-9_.-]{0,31}$/i;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const AMOUNT = /^\d+(\.\d+)?$/;

/** What kind of recipient a field names: "address", "tag", "email", or "". */
export function recipientKind(field, { emails = false } = {}) {
  const text = String(field ?? "").trim();
  if (ADDRESS.test(text)) return "address";
  if (emails && EMAIL.test(text)) return "email";
  if (text.startsWith("@") && TAG.test(text)) return "tag";
  return "";
}

/** One line cut into fields: by comma, semicolon or tab, or else by spaces. */
function fields(line) {
  const parts = /[,;\t]/.test(line) ? line.split(/[,;\t]/) : line.trim().split(/\s+/);
  return parts.map((p) => p.trim().replace(/^"(.*)"$/, "$1").trim());
}

/** "1,000.50" → "1000.50"; "$25" → "25". Not a number → "". */
function readAmount(text) {
  const plain = String(text ?? "").replace(/^\$/, "").replace(/_/g, "");
  return AMOUNT.test(plain) ? plain : "";
}

/** `amount` in base units at `decimals`, or null when it has more decimals than the token. */
export function toUnits(amount, decimals) {
  const [whole, frac = ""] = String(amount).split(".");
  if (frac.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/**
 * Read a pasted list or CSV.
 *
 * Returns { payments: [{ line, to, kind, amount, units, note }], errors:
 * [{ line, reason }] }. A first line whose amount is not a number is a header
 * and is skipped; blank lines and lines starting with # are skipped.
 * `reason` is a short English code: "recipient", "amount", "decimals", "zero",
 * "duplicate", "too-many", "columns".
 */
export function parse(text, { decimals = 6, emails = false } = {}) {
  const payments = [];
  const errors = [];
  const seen = new Map();
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const parts = fields(trimmed);
    // Commas inside a written note (the third column on) are kept.
    const [to = "", amountText = "", ...rest] = parts;
    const note = rest.join(", ").trim().slice(0, LIMITS.maxNote);
    const amount = readAmount(amountText);
    if (index === 0 || payments.length + errors.length === 0) {
      // A header: words where the address and amount would be.
      if (!recipientKind(to, { emails }) && !amount && /[a-z]/i.test(trimmed)) return;
    }
    if (parts.length < 2) return void errors.push({ line, reason: "columns" });
    const kind = recipientKind(to, { emails });
    if (!kind) return void errors.push({ line, reason: "recipient" });
    if (!amount) return void errors.push({ line, reason: "amount" });
    const units = toUnits(amount, decimals);
    if (units === null) return void errors.push({ line, reason: "decimals" });
    if (units === 0n) return void errors.push({ line, reason: "zero" });
    const key = to.toLowerCase().replace(/^@/, "");
    if (seen.has(key)) return void errors.push({ line, reason: "duplicate", first: seen.get(key) });
    seen.set(key, line);
    if (payments.length >= LIMITS.maxPayments) return void errors.push({ line, reason: "too-many" });
    payments.push({ line, to, kind, amount, units, note });
  });
  return { payments, errors };
}

/** The sum of the payments, in base units. */
export const total = (payments) => (payments || []).reduce((sum, p) => sum + BigInt(p.units), 0n);

/** The largest single payment, in base units. */
export const largest = (payments) =>
  (payments || []).reduce((max, p) => (BigInt(p.units) > max ? BigInt(p.units) : max), 0n);

/** A starting file for the upload, with the columns named. */
export const TEMPLATE = "recipient,amount,note\n0x0000000000000000000000000000000000000000,10,example — replace this line\n";
