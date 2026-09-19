// Pure tag utilities for backend service
// Self-contained to avoid monorepo boundary crossing in Docker runtime

export const TagError = class TagError extends Error {};

export const LIMITS = {
  minLength: 3,
  maxLength: 20,
  charset: "a-z, 0-9 and underscore",
  shape: "starts with a letter, no trailing or doubled underscore",
};

const WELL_FORMED = /^[a-z][a-z0-9_]{1,18}[a-z0-9]$/;

export const RESERVED = new Set([
  "tera",
  "terawallet",
  "terateam",
  "team",
  "admin",
  "administrator",
  "root",
  "system",
  "official",
  "verified",
  "support",
  "help",
  "helpdesk",
  "security",
  "recovery",
  "wallet",
  "staking",
  "stake",
  "rewards",
  "airdrop",
  "treasury",
  "vault",
  "bridge",
  "swap",
  "send",
  "deposit",
  "withdraw",
  "refund",
  "fee",
  "gas",
  "null",
  "none",
  "undefined",
  "anonymous",
  "robinhood",
  "usdg",
]);

const CONFUSABLE: Record<string, string> = {
  0: "o",
  1: "l",
  i: "l",
  3: "e",
  4: "a",
  5: "s",
  7: "t",
  8: "b",
  9: "g",
};

export function skeleton(tag: unknown): string {
  return String(tag ?? "")
    .toLowerCase()
    .replace(/_/g, "")
    .split("")
    .map((character) => CONFUSABLE[character] ?? character)
    .join("");
}

export function parseTag(input: unknown): { ok: boolean; tag: string; reason: string } {
  const raw = String(input ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  if (!raw) return { ok: false, tag: "", reason: "Enter a tag." };
  if (raw.length < LIMITS.minLength)
    return { ok: false, tag: "", reason: `A tag is at least ${LIMITS.minLength} characters.` };
  if (raw.length > LIMITS.maxLength)
    return { ok: false, tag: "", reason: `A tag is at most ${LIMITS.maxLength} characters.` };
  if (/[^a-z0-9_]/.test(raw))
    return {
      ok: false,
      tag: "",
      reason: `A tag uses only ${LIMITS.charset}. Letters that look alike but are from another alphabet are not accepted.`,
    };
  if (!WELL_FORMED.test(raw))
    return {
      ok: false,
      tag: "",
      reason: "A tag starts with a letter and does not end with an underscore.",
    };
  if (/__/.test(raw))
    return { ok: false, tag: "", reason: "A tag does not contain two underscores in a row." };
  if (RESERVED.has(raw)) return { ok: false, tag: "", reason: "This tag is reserved." };

  return { ok: true, tag: raw, reason: "" };
}

export function normalise(input: unknown): string {
  const parsed = parseTag(input);
  if (!parsed.ok) throw new TagError(parsed.reason);
  return parsed.tag;
}

export const display = (tag: unknown): string => `@${String(tag ?? "").replace(/^@+/, "")}`;

export function claimMessage({
  tag,
  address,
  timestamp,
}: {
  tag: unknown;
  address: unknown;
  timestamp: unknown;
}): string {
  const name = normalise(tag);
  const owner = String(address ?? "").toLowerCase();
  if (!/^0x[\da-f]{40}$/.test(owner)) throw new TagError("A claim needs a wallet address.");
  if (!Number.isSafeInteger(timestamp) || (timestamp as number) <= 0)
    throw new TagError("A claim needs a timestamp.");
  return `Tera Wallet tag claim
Tag: ${display(name)}
Wallet: ${owner}
Timestamp: ${timestamp}`;
}

export function releaseMessage({
  tag,
  address,
  timestamp,
}: {
  tag: unknown;
  address: unknown;
  timestamp: unknown;
}): string {
  return claimMessage({ tag, address, timestamp }).replace(
    "Tera Wallet tag claim",
    "Tera Wallet tag release",
  );
}
