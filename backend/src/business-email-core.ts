// Copy of public/tera/core/business-email.js for the Docker image, which does
// not ship the site's public folder. The tests check the two build the same
// bytes, so a wallet never signs text this service would rebuild differently.

export class EmailError extends Error {}

export const MAX_EMAIL = 254;
export const MAX_NAME = 60;

const SHAPE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function parseEmail(input: unknown): { ok: boolean; email: string; reason: string } {
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

export function cleanName(input: unknown): string {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

type Fields = { email: unknown; name?: unknown; address: unknown; timestamp: unknown };

function base(kind: "link" | "unlink", { email, name, address, timestamp }: Fields): string {
  const parsed = parseEmail(email);
  if (!parsed.ok) throw new EmailError(parsed.reason);
  const owner = String(address ?? "").toLowerCase();
  if (!/^0x[\da-f]{40}$/.test(owner)) throw new EmailError("A wallet address is required.");
  if (!Number.isSafeInteger(timestamp) || (timestamp as number) <= 0)
    throw new EmailError("A timestamp is required.");
  const lines = [`Tera Business email ${kind}`, `Email: ${parsed.email}`];
  if (kind === "link") lines.push(`Name: ${cleanName(name)}`);
  lines.push(`Wallet: ${owner}`, `Timestamp: ${timestamp}`);
  return lines.join("\n");
}

export const linkMessage = (fields: Fields) => base("link", fields);
export const unlinkMessage = (fields: Fields) => base("unlink", fields);
