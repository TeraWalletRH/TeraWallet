// Merchant payment links: a business asks for an exact dollar amount, and whoever
// opens the link pays it from the Spend screen.
//
// A link is a request, not a payment and not an identity. It names three things
// — the address to pay, the amount in USDG, and a note — and Tera keeps it so
// the merchant can see when it was paid. What it proves about who is asking is
// only this: the wallet that will be paid signed for the link. The name a payer
// sees next to it is the business email that wallet proved, when it has one;
// anything else is just an address, and the Spend screen shows it as one.
//
// "Paid" is not something a payer can claim. The payer's app reports the
// transaction hash, and the service reads that transaction from the chain: it
// must have succeeded, moved exactly the amount in USDG to the merchant, and
// not already have paid another link.

/** Where links open. The app reads `?pay=` on launch. */
export const LINK_BASE = "https://terawallet.app/app/";
/** Link ids: 12 characters from an alphabet with no look-alikes to misread. */
export const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const ID_LENGTH = 12;
export const NOTE_MAX = 140;
/** USDG has 6 decimals; a link asks for whole cents, up to $1,000,000. */
export const CENT = 10000n;
export const MAX_UNITS = 1000000n * 1000000n;
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const isLinkId = (input) =>
  typeof input === "string" &&
  input.length === ID_LENGTH &&
  [...input].every((c) => ID_ALPHABET.includes(c));

/** One line of plain text, so a note cannot pass for another line of what is signed. */
export function cleanNote(input) {
  const note = String(input ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (note.length > NOTE_MAX)
    return { ok: false, note, reason: `Keep the note to ${NOTE_MAX} characters.` };
  return { ok: true, note, reason: "" };
}

/** An amount in USDG base units a link can ask for, or a reason it cannot. */
export function checkAmount(input) {
  let units;
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

/** What the merchant's wallet signs to open a link. */
export const createMessage = ({ merchant, amount, note, timestamp }) =>
  [
    "Tera payment link",
    "Action: create",
    `Merchant: ${String(merchant).toLowerCase()}`,
    `Amount: ${String(amount)} USDG base units`,
    `Note: ${note}`,
    `Time: ${timestamp}`,
  ].join("\n");

/** What the merchant's wallet signs to list its links. */
export const listMessage = ({ merchant, timestamp }) =>
  [
    "Tera payment link",
    "Action: list",
    `Merchant: ${String(merchant).toLowerCase()}`,
    `Time: ${timestamp}`,
  ].join("\n");

/** What the merchant's wallet signs to close a link before it is paid. */
export const cancelMessage = ({ merchant, id, timestamp }) =>
  [
    "Tera payment link",
    "Action: cancel",
    `Merchant: ${String(merchant).toLowerCase()}`,
    `Link: ${id}`,
    `Time: ${timestamp}`,
  ].join("\n");

export const linkUrl = (id, base = LINK_BASE) => `${base}?pay=${id}`;

/** The link id in a pasted link, or a bare id; null for anything else. */
export function parseLink(input) {
  const text = String(input ?? "").trim();
  if (isLinkId(text)) return text;
  const match = text.match(/[?&]pay=([^&#\s]+)/);
  return match && isLinkId(match[1]) ? match[1] : null;
}

const topicAddress = (topic) => `0x${String(topic).slice(-40)}`.toLowerCase();

/**
 * The USDG transfer in a transaction's logs that pays a link: from anyone, to
 * the merchant, for exactly the amount. Null when there is none.
 */
export function paymentIn(logs, { token, merchant, amount }) {
  const want = BigInt(amount);
  for (const log of logs || []) {
    const topics = log?.topics || [];
    if (String(log?.address).toLowerCase() !== String(token).toLowerCase()) continue;
    if (String(topics[0]).toLowerCase() !== TRANSFER_TOPIC || topics.length !== 3) continue;
    if (topicAddress(topics[2]) !== String(merchant).toLowerCase()) continue;
    let value;
    try {
      value = BigInt(log.data);
    } catch {
      continue;
    }
    if (value === want) return { from: topicAddress(topics[1]), value };
  }
  return null;
}
