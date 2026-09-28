// Copy of public/tera/core/pay-links.js for the Docker image, which does not
// ship the site's public folder. The tests check the two agree, so a merchant
// never signs text this service would rebuild differently.

export const LINK_BASE = "https://terawallet.app/app/";
export const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const ID_LENGTH = 12;
export const NOTE_MAX = 140;
export const CENT = 10000n;
export const MAX_UNITS = 1000000n * 1000000n;
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const isLinkId = (input: unknown): boolean =>
  typeof input === "string" &&
  input.length === ID_LENGTH &&
  [...input].every((c) => ID_ALPHABET.includes(c));

export function cleanNote(input: unknown) {
  const note = String(input ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (note.length > NOTE_MAX)
    return { ok: false, note, reason: `Keep the note to ${NOTE_MAX} characters.` };
  return { ok: true, note, reason: "" };
}

export function checkAmount(
  input: unknown,
): { ok: true; units: bigint; reason: "" } | { ok: false; reason: string } {
  let units: bigint;
  try {
    units = BigInt(String(input));
  } catch {
    return { ok: false, reason: "Enter an amount in dollars." };
  }
  if (units <= 0n) return { ok: false, reason: "Enter an amount above zero." };
  if (units % CENT !== 0n) return { ok: false, reason: "Ask for whole cents." };
  if (units > MAX_UNITS) return { ok: false, reason: "A link can ask for $1,000,000 at most." };
  return { ok: true, units, reason: "" };
}

type Signed = { merchant: string; timestamp: number };

export const createMessage = ({
  merchant,
  amount,
  note,
  timestamp,
}: Signed & { amount: string | bigint; note: string }) =>
  [
    "Tera payment link",
    "Action: create",
    `Merchant: ${String(merchant).toLowerCase()}`,
    `Amount: ${String(amount)} USDG base units`,
    `Note: ${note}`,
    `Time: ${timestamp}`,
  ].join("\n");

export const listMessage = ({ merchant, timestamp }: Signed) =>
  [
    "Tera payment link",
    "Action: list",
    `Merchant: ${String(merchant).toLowerCase()}`,
    `Time: ${timestamp}`,
  ].join("\n");

export const cancelMessage = ({ merchant, id, timestamp }: Signed & { id: string }) =>
  [
    "Tera payment link",
    "Action: cancel",
    `Merchant: ${String(merchant).toLowerCase()}`,
    `Link: ${id}`,
    `Time: ${timestamp}`,
  ].join("\n");

export const linkUrl = (id: string, base = LINK_BASE) => `${base}?pay=${id}`;

export function parseLink(input: unknown) {
  const text = String(input ?? "").trim();
  if (isLinkId(text)) return text;
  const match = text.match(/[?&]pay=([^&#\s]+)/);
  return match && isLinkId(match[1]) ? match[1] : null;
}

const topicAddress = (topic: unknown) => `0x${String(topic).slice(-40)}`.toLowerCase();

type Log = { address?: unknown; topics?: readonly unknown[]; data?: unknown };

export function paymentIn(
  logs: readonly Log[] | undefined,
  { token, merchant, amount }: { token: string; merchant: string; amount: string | bigint },
) {
  const want = BigInt(amount);
  for (const log of logs || []) {
    const topics = log?.topics || [];
    if (String(log?.address).toLowerCase() !== String(token).toLowerCase()) continue;
    if (String(topics[0]).toLowerCase() !== TRANSFER_TOPIC || topics.length !== 3) continue;
    if (topicAddress(topics[2]) !== String(merchant).toLowerCase()) continue;
    let value: bigint;
    try {
      value = BigInt(String(log.data));
    } catch {
      continue;
    }
    if (value === want) return { from: topicAddress(topics[1]), value };
  }
  return null;
}
