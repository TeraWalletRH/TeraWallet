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

/** Format USDG units into readable dollar amount (e.g. 25000000 -> "$25.00"). */
export function formatInvoiceAmount(amountUnits) {
  try {
    const bi = BigInt(String(amountUnits ?? 0));
    const whole = bi / 1000000n;
    const cents = (bi % 1000000n) / 10000n;
    return `$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
  } catch {
    return "$0.00";
  }
}

/** Determine the status of an invoice: "waiting" | "settled" | "cancelled". */
export function invoiceStatus(link) {
  if (!link) return "waiting";
  if (link.status === "cancelled" || link.cancelled) return "cancelled";
  if (link.status === "paid" || Boolean(link.paidTx)) return "settled";
  return "waiting";
}

/** Builds an interactive invoice card data structure from a payment link. */
export function createInvoiceCard(link, { networkName = "Robinhood Chain" } = {}) {
  const status = invoiceStatus(link);
  const id = link?.id || "";
  const payUrl = linkUrl(id);
  const amountFormatted = formatInvoiceAmount(link?.amount);
  const merchant = link?.merchant || "";
  const name = link?.name || link?.email || "Tera Merchant";
  const note = link?.note || "";

  return {
    id,
    merchant,
    name,
    amount: String(link?.amount || "0"),
    amountFormatted,
    note,
    payUrl,
    status,
    networkName,
    paidTx: link?.paidTx || null,
    payer: link?.payer || null,
    paidAt: link?.paidAt || null,
    isSettled: status === "settled",
  };
}

/**
 * Render shareable merchant invoice card HTML with branded layout,
 * live status indicator, QR code container, and auto-settlement flip.
 */
export function renderInvoiceCardHtml(invoice, { qrSvg = "" } = {}) {
  const isSettled = invoice.status === "settled";
  const statusLabel = isSettled ? "Paid & Verified" : "Waiting for payment...";
  const statusClass = isSettled ? "settled" : "waiting";

  return `<div class="tera-invoice-card ${statusClass}" data-invoice-id="${invoice.id}">
  <div class="invoice-header">
    <div class="merchant-badge">
      <span class="merchant-name">${invoice.name}</span>
      <span class="network-tag">${invoice.networkName}</span>
    </div>
    <div class="invoice-status-pill ${statusClass}">
      <span class="status-dot"></span>
      <span class="status-text">${statusLabel}</span>
    </div>
  </div>

  <div class="invoice-amount-section">
    <span class="amount-value">${invoice.amountFormatted}</span>
    <span class="currency-label">USDG</span>
  </div>
  ${invoice.note ? `<p class="invoice-note">${invoice.note}</p>` : ""}

  ${
    isSettled
      ? `<div class="invoice-settled-view">
          <div class="settled-icon">✓</div>
          <h3>Payment Received</h3>
          <p class="settled-detail">Settled on Robinhood Chain</p>
          ${invoice.paidTx ? `<div class="tx-hash"><span>Tx:</span> <code>${invoice.paidTx.slice(0, 10)}…${invoice.paidTx.slice(-8)}</code></div>` : ""}
          ${invoice.payer ? `<div class="payer-addr"><span>From:</span> <code>${invoice.payer.slice(0, 8)}…${invoice.payer.slice(-6)}</code></div>` : ""}
        </div>`
      : `<div class="invoice-qr-section">
          <div class="qr-wrapper">
            ${qrSvg || `<img src="/api/pay-links/qr/${invoice.id}" alt="Payment QR Code" class="qr-img" />`}
          </div>
          <p class="qr-instruction">Scan with camera or mobile wallet to pay</p>
          <div class="pay-link-copy">
            <input type="text" readonly value="${invoice.payUrl}" class="pay-url-input" />
          </div>
        </div>`
  }
</div>`;
}

/**
 * Poll payment link status until settled, cancelled, or aborted.
 */
export async function pollInvoiceSettlement({
  id,
  fetchFn,
  intervalMs = 2000,
  maxAttempts = 120,
  onStatusChange,
  signal,
}) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    if (signal?.aborted) return null;
    try {
      const res = await fetchFn(id);
      const link = res?.link || res;
      const status = invoiceStatus(link);
      if (onStatusChange) onStatusChange({ link, status, settled: status === "settled" });
      if (status === "settled") return { link, settled: true };
      if (status === "cancelled") return { link, cancelled: true };
    } catch {
      // Continue polling
    }
    attempts++;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

