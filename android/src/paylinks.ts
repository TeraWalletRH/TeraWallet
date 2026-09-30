// Merchant payment links, as this app sees them.
//
// Paying one works on every surface: the Spend screen reads a link, fixes the
// amount and the payee to what it asks for, and after the payment is sent
// reports the transaction hash so the merchant sees it paid. Tera checks that
// hash on chain — see core/pay-links.js. Making links lives in Tera Business.

import type { Address } from "viem";
import { api } from "./api";
import * as vault from "./storage";
import {
  cancelMessage,
  cleanNote,
  createMessage,
  linkUrl,
  listMessage,
  parseLink,
} from "../../public/tera/core/pay-links.js";

export { cleanNote, linkUrl, parseLink };

export type PayLink = {
  id: string;
  link: string;
  merchant: Address;
  /** USDG base units. */
  amount: string;
  note: string;
  status: "open" | "paid" | "cancelled";
  createdAt: string;
  paidTx: string | null;
  payer: Address | null;
  paidAt: string | null;
  /** The business email the merchant's wallet proved, if any. */
  email: string | null;
  name: string;
};

let available = false;
export const payLinksAvailable = () => available;

/** Asked on launch. A failure leaves links off rather than showing dead controls. */
export async function loadPayLinksConfig() {
  try {
    available = Boolean((await api("/api/pay-links/config")).enabled);
  } catch {
    available = false;
  }
  return available;
}

export async function viewLink(id: string) {
  return (await api("/api/pay-links/view", { id })).link as PayLink;
}

/** Tell Tera which transaction paid a link. It is checked on chain, not taken on trust. */
export async function reportPaid(id: string, tx: string) {
  return (await api("/api/pay-links/paid", { id, tx })).link as PayLink;
}

export async function createLink(amount: bigint, note: string) {
  const account = vault.currentAccount();
  const timestamp = Date.now();
  const clean = cleanNote(note).note;
  const signature = await account.signMessage({
    message: createMessage({ merchant: account.address, amount, note: clean, timestamp }),
  });
  return (
    await api("/api/pay-links/create", {
      merchant: account.address,
      amount: amount.toString(),
      note: clean,
      timestamp,
      signature,
    })
  ).link as PayLink;
}

// A list signature is reused for four minutes, inside the service's five, so
// reopening the screen does not ask the wallet to sign again each time.
let listed: { merchant: string; timestamp: number; signature: string } | null = null;

export async function myLinks() {
  const account = vault.currentAccount();
  if (!listed || listed.merchant !== account.address || Date.now() - listed.timestamp > 240_000) {
    const timestamp = Date.now();
    const signature = await account.signMessage({
      message: listMessage({ merchant: account.address, timestamp }),
    });
    listed = { merchant: account.address, timestamp, signature };
  }
  return (await api("/api/pay-links/mine", listed)).links as PayLink[];
}

export async function cancelLink(id: string) {
  const account = vault.currentAccount();
  const timestamp = Date.now();
  const signature = await account.signMessage({
    message: cancelMessage({ merchant: account.address, id, timestamp }),
  });
  return (
    await api("/api/pay-links/cancel", { merchant: account.address, id, timestamp, signature })
  ).link as PayLink;
}
