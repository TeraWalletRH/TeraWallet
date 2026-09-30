// Business email on the web: getting paid at an email, and paying one.
//
// The same trust as a tag (see ../tags.ts): Tera's register answers which
// address an email stands for, and the transfer is still built from that
// address, which the review screen shows. See core/business-email.js for why
// linking takes both a wallet signature and a code from the inbox.

import type { Address } from "viem";
import { api } from "../api";
import * as vault from "../storage";
import {
  cleanName,
  linkMessage,
  looksLikeEmail,
  parseEmail,
  unlinkMessage,
} from "../../../public/tera/core/business-email.js";

export { cleanName, parseEmail };

let available = false;
export const emailAvailable = () => available;

/** Asked on launch. A failure leaves email payments off rather than showing dead controls. */
export async function loadEmailConfig() {
  try {
    available = Boolean((await api("/api/business/email/config")).enabled);
  } catch {
    available = false;
  }
  return available;
}

export const isEmail = (input: string) => looksLikeEmail(input);

function canonical(input: string) {
  const parsed = parseEmail(input) as { ok: boolean; email: string; reason: string };
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.email;
}

/** The address a business is paid at. Throws if no business linked the email. */
export async function resolveEmail(input: string) {
  const email = canonical(input);
  const result = await api("/api/business/email/resolve", { email });
  if (!result.address) throw new Error(`No Tera Business wallet is paid at ${email}.`);
  // Named `tag` to fit the send screen's lookup state, which shows it as typed.
  return { tag: email, address: result.address as Address, name: String(result.name || "") };
}

export async function linkedEmail(address: Address) {
  const result = await api(`/api/business/email/by-address/${address}`);
  return result.email ? { email: String(result.email), name: String(result.name || "") } : null;
}

/** Sign for the email with the open account, and have a code sent to the inbox. */
export async function sendCode(email: string, name: string) {
  const account = vault.currentAccount();
  const canonicalEmail = canonical(email);
  const timestamp = Date.now();
  const message = linkMessage({ email: canonicalEmail, name, address: account.address, timestamp });
  const signature = await account.signMessage({ message });
  await api("/api/business/email/start", {
    email: canonicalEmail,
    name: cleanName(name),
    owner: account.address,
    timestamp,
    signature,
  });
  return { email: canonicalEmail, address: account.address };
}

export async function confirmCode(email: string, address: Address, code: string) {
  return api("/api/business/email/verify", {
    email: canonical(email),
    owner: address,
    code: code.trim(),
  });
}

export async function unlinkEmail(email: string) {
  const account = vault.currentAccount();
  const canonicalEmail = canonical(email);
  const timestamp = Date.now();
  const message = unlinkMessage({ email: canonicalEmail, address: account.address, timestamp });
  const signature = await account.signMessage({ message });
  await api("/api/business/email/unlink", {
    email: canonicalEmail,
    owner: account.address,
    timestamp,
    signature,
  });
}
