// Business email: an address a Tera Business wallet can be paid at.
//
// A business already hands out an email, not a tag, so an owner links one to
// their business wallet and anyone paying them can type it instead of forty
// hex characters. Like a tag, the email is a name Tera's register turns into
// an address; the address is still what a transfer is built from and what the
// review screen shows.
//
// Linking needs two proofs, and each one guards against a different mistake:
//
//   The wallet signs the text below, so nobody can point someone else's
//   wallet at an email it never asked for.
//
//   The inbox receives a code, so nobody can point an email they do not read
//   at their own wallet — which is the attack that matters, because it would
//   route a business's customers' payments to a stranger.
//
// The email is not a login and cannot recover anything. The recovery phrase is
// still the only way back into the wallet, and the linking screen says so.
//
// This file is the grammar and the exact bytes signed, shared by the web app
// that signs and the service that verifies (backend/src/business-email-core.ts
// is a copy for the Docker image, checked against this one in the tests).

export const EmailError = class EmailError extends Error {};

export const MAX_EMAIL = 254;
export const MAX_NAME = 60;

// Deliberately plain: one @, no spaces, a dot in the domain. The inbox proves
// the rest — a shape check here is only to catch typing mistakes early.
const SHAPE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** The canonical email, or the reason it is not one. */
export function parseEmail(input) {
  const email = String(input ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  if (!email) return { ok: false, email: "", reason: "Enter an email address." };
  if (email.length > MAX_EMAIL) return { ok: false, email: "", reason: "That email is too long." };
  if (!SHAPE.test(email))
    return { ok: false, email: "", reason: "That does not look like an email address." };
  return { ok: true, email, reason: "" };
}

/** Whether text is meant as an email, before it is checked as one. */
export const looksLikeEmail = (input) =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(input ?? "").trim());

/** A business's display name: one line, trimmed, capped. */
export function cleanName(input) {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

function base(kind, { email, name, address, timestamp }) {
  const parsed = parseEmail(email);
  if (!parsed.ok) throw new EmailError(parsed.reason);
  const owner = String(address ?? "").toLowerCase();
  if (!/^0x[\da-f]{40}$/.test(owner)) throw new EmailError("A wallet address is required.");
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0)
    throw new EmailError("A timestamp is required.");
  const lines = [`Tera Business email ${kind}`, `Email: ${parsed.email}`];
  if (kind === "link") lines.push(`Name: ${cleanName(name)}`);
  lines.push(`Wallet: ${owner}`, `Timestamp: ${timestamp}`);
  return lines.join("\n");
}

/** What the wallet signs to ask for a code to be sent to this email. */
export const linkMessage = (fields) => base("link", fields);

/** What the wallet signs to stop being paid at this email. */
export const unlinkMessage = (fields) => base("unlink", fields);
