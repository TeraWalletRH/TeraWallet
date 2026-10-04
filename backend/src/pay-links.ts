// Merchant payment links: the register of what a business has asked to be paid,
// and which of those requests the chain shows as settled.
//
// Opening, listing and cancelling a link each take a signature from the
// merchant's wallet over the text in core/pay-links.js. Reading a link takes
// only its id — whoever holds the link is who it was sent to. Marking one paid
// takes a transaction hash, and the service reads that transaction itself, so
// the claim is only ever as good as the chain says it is.

import { randomInt } from "node:crypto";
import { createPublicClient, getAddress, http, isAddress, verifyMessage, type Hex } from "viem";
import { USDG } from "./bridge";
import pool from "./db";
import { env } from "./env";
import QRCode from "qrcode";
import {
  ID_ALPHABET,
  ID_LENGTH,
  cancelMessage,
  checkAmount,
  cleanNote,
  createMessage,
  isLinkId,
  linkUrl,
  listMessage,
  paymentIn,
  createInvoiceCard,
} from "./pay-links-core";

const SIGNATURE_WINDOW_MS = 5 * 60_000;
/** A payment may land a little before the service saw the link, clocks being clocks. */
const CLOCK_SLACK_MS = 5 * 60_000;

export class PayLinkError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

const must = (condition: unknown, message: string, status = 422) => {
  if (!condition) throw new PayLinkError(message, status);
};

export const enabled = () => Boolean(env.payLinksEnabled && pool);

export function config() {
  return {
    enabled: enabled(),
    requires: { flag: env.payLinksEnabled, database: Boolean(pool) },
    token: USDG,
    authority:
      "Tera keeps the list of links and marks one paid only after reading the payment from the chain. A link cannot move money on its own: the payer reviews and signs every payment.",
  };
}

const client = createPublicClient({ transport: http(env.rhcRpcUrl, { timeout: 20_000 }) });

function wallet(input: unknown) {
  must(
    typeof input === "string" && isAddress(input, { strict: false }),
    "A wallet address is required.",
  );
  return getAddress(input as string);
}

function linkId(input: unknown) {
  must(isLinkId(input), "That is not a Tera payment link.", 404);
  return input as string;
}

async function signedBy(message: string, address: `0x${string}`, body: Record<string, unknown>) {
  const { signature, timestamp } = body;
  must(
    typeof signature === "string" && /^0x[\da-fA-F]{130}$/.test(signature),
    "A wallet signature is required.",
  );
  must(
    typeof timestamp === "number" &&
      Number.isSafeInteger(timestamp) &&
      Math.abs(Date.now() - timestamp) < SIGNATURE_WINDOW_MS,
    "This request has expired. Sign a new one and try again.",
  );
  let valid = false;
  try {
    valid = await verifyMessage({ address, message, signature: signature as Hex });
  } catch {
    valid = false;
  }
  must(valid, "That signature did not match this wallet.", 403);
}

export const newId = () =>
  Array.from({ length: ID_LENGTH }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");

type Row = {
  id: string;
  merchant: string;
  amount: string;
  note: string;
  status: string;
  created_at: Date;
  paid_tx: string | null;
  payer: string | null;
  paid_at: Date | null;
  email?: string | null;
  business_name?: string | null;
};

const shape = (row: Row) => ({
  id: row.id,
  link: linkUrl(row.id),
  merchant: getAddress(row.merchant),
  amount: String(row.amount),
  note: row.note,
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
  paidTx: row.paid_tx,
  payer: row.payer ? getAddress(row.payer) : null,
  paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
  // The business email the merchant's wallet proved, when it has one. The
  // only name a payer is shown; the note is the merchant's own words.
  email: row.email ?? null,
  name: row.business_name ?? "",
});

const SELECT = `SELECT l.*, e.email, e.business_name FROM payment_links l
  LEFT JOIN business_emails e ON e.owner_address = l.merchant`;

async function find(id: string) {
  const found = await pool!.query(`${SELECT} WHERE l.id=$1`, [id]);
  must(found.rows[0], "This payment link does not exist.", 404);
  return found.rows[0] as Row;
}

export async function createLink(body: Record<string, unknown>) {
  const merchant = wallet(body.merchant);
  const amount = checkAmount(body.amount);
  must(amount.ok, amount.ok ? "" : amount.reason);
  const units = (amount as { units: bigint }).units;
  const note = cleanNote(body.note);
  must(note.ok, note.reason);
  await signedBy(
    createMessage({
      merchant,
      amount: units,
      note: note.note,
      timestamp: body.timestamp as number,
    }),
    merchant,
    body,
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId();
    const inserted = await pool!.query(
      `INSERT INTO payment_links (id, merchant, amount, note) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, merchant, units.toString(), note.note],
    );
    if (inserted.rowCount) return { link: shape(await find(id)) };
  }
  throw new PayLinkError("Could not open a link. Try again.", 503);
}

export async function viewLink(body: Record<string, unknown>) {
  return { link: shape(await find(linkId(body.id))) };
}

export async function myLinks(body: Record<string, unknown>) {
  const merchant = wallet(body.merchant);
  await signedBy(listMessage({ merchant, timestamp: body.timestamp as number }), merchant, body);
  const found = await pool!.query(
    `${SELECT} WHERE l.merchant=$1 ORDER BY l.created_at DESC LIMIT 200`,
    [merchant],
  );
  return { links: (found.rows as Row[]).map(shape) };
}

export async function cancelLink(body: Record<string, unknown>) {
  const merchant = wallet(body.merchant);
  const id = linkId(body.id);
  await signedBy(
    cancelMessage({ merchant, id, timestamp: body.timestamp as number }),
    merchant,
    body,
  );
  const row = await find(id);
  must(getAddress(row.merchant) === merchant, "Only the merchant can cancel this link.", 403);
  must(row.status === "open", "Only an unpaid link can be cancelled.", 409);
  await pool!.query(
    "UPDATE payment_links SET status='cancelled', cancelled_at=NOW() WHERE id=$1 AND status='open'",
    [id],
  );
  return { link: shape(await find(id)) };
}

/**
 * Mark a link paid by the transaction that paid it. The transaction must have
 * succeeded, moved exactly the amount in USDG to the merchant, landed after
 * the link was opened, and not already have settled another link.
 */
export async function markPaid(body: Record<string, unknown>) {
  const id = linkId(body.id);
  const tx = body.tx;
  must(typeof tx === "string" && /^0x[\da-fA-F]{64}$/.test(tx), "A transaction hash is required.");
  const row = await find(id);
  if (row.status === "paid") {
    must(
      String(row.paid_tx).toLowerCase() === (tx as string).toLowerCase(),
      "This link was already paid by another transaction.",
      409,
    );
    return { link: shape(row) };
  }
  must(row.status === "open", "This link was cancelled by the merchant.", 409);
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: tx as Hex });
  } catch {
    throw new PayLinkError(
      "That transaction is not on chain yet. Try again once it confirms.",
      409,
    );
  }
  must(receipt.status === "success", "That transaction failed, so it paid nothing.");
  const payment = paymentIn(receipt.logs, {
    token: USDG,
    merchant: row.merchant,
    amount: String(row.amount),
  });
  must(payment, "That transaction does not pay this link's amount in USDG to its merchant.");
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  must(
    Number(block.timestamp) * 1000 >= new Date(row.created_at).getTime() - CLOCK_SLACK_MS,
    "That transaction was made before this link existed.",
  );
  try {
    await pool!.query(
      `UPDATE payment_links SET status='paid', paid_tx=$2, payer=$3, paid_at=NOW()
       WHERE id=$1 AND status='open'`,
      [id, (tx as string).toLowerCase(), getAddress(payment!.from)],
    );
  } catch {
    throw new PayLinkError("That transaction already paid another link.", 409);
  }
  const updated = await find(id);
  must(
    updated.status === "paid" && String(updated.paid_tx) === (tx as string).toLowerCase(),
    "This link changed while it was being checked. Open it again.",
    409,
  );
  return { link: shape(updated) };
}

export async function invoiceLink(body: Record<string, unknown>) {
  const id = linkId(body.id);
  const row = await find(id);
  const link = shape(row);
  const invoice = createInvoiceCard(link);
  let qrSvg = "";
  try {
    qrSvg = await QRCode.toString(link.link, { type: "svg", margin: 2 });
  } catch {
    qrSvg = "";
  }
  return { link, invoice, qrSvg };
}

export async function qrLink(body: Record<string, unknown>) {
  const id = linkId(body.id);
  const row = await find(id);
  const link = shape(row);
  const qrSvg = await QRCode.toString(link.link, { type: "svg", margin: 2 });
  return { id: link.id, payUrl: link.link, qrSvg };
}

