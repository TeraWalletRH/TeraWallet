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

export function formatInvoiceAmount(amountUnits: unknown): string {
  try {
    const bi = BigInt(String(amountUnits ?? 0));
    const whole = bi / 1000000n;
    const cents = (bi % 1000000n) / 10000n;
    return `$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
  } catch {
    return "$0.00";
  }
}

export function invoiceStatus(link: any): "waiting" | "settled" | "cancelled" {
  if (!link) return "waiting";
  if (link.status === "cancelled" || link.cancelled) return "cancelled";
  if (link.status === "paid" || Boolean(link.paidTx)) return "settled";
  return "waiting";
}

export interface InvoiceCard {
  id: string;
  merchant: string;
  name: string;
  amount: string;
  amountFormatted: string;
  note: string;
  payUrl: string;
  status: "waiting" | "settled" | "cancelled";
  networkName: string;
  paidTx: string | null;
  payer: string | null;
  paidAt: string | null;
  isSettled: boolean;
}

export function createInvoiceCard(
  link: any,
  { networkName = "Robinhood Chain" } = {},
): InvoiceCard {
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

export function renderInvoiceCardHtml(invoice: InvoiceCard, { qrSvg = "" } = {}): string {
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

export async function pollInvoiceSettlement({
  id,
  fetchFn,
  intervalMs = 2000,
  maxAttempts = 120,
  onStatusChange,
  signal,
}: {
  id: string;
  fetchFn: (id: string) => Promise<any>;
  intervalMs?: number;
  maxAttempts?: number;
  onStatusChange?: (update: { link: any; status: string; settled: boolean }) => void;
  signal?: AbortSignal;
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

