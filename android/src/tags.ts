// Tags on the phone.
//
// The shared core holds the grammar and the exact text a claim is signed
// over; Tera keeps the register. This file is the adapter between those and
// what the app already has — its API client, and the owner's unlocked account
// for the signature.
//
// Worth being clear about what this trusts, because it differs from the rest
// of this app: a balance is read from the chain and a transfer is rebuilt from
// calldata before signing, but a tag is whatever Tera says it is. There is no
// second source to check it against. So the review sheet shows the resolved
// address, not a tick beside the name — the address is the part a wrong answer
// cannot survive an owner actually reading.
//
// The transfer is still built from the address. `validation.ts` rebuilds the
// calldata from what it was handed and would not notice a name at all.

import { type Address } from "viem";
import { api } from "./api";
import { API } from "./config";
import { claimMessage, display, parseTag } from "../../public/tera/core/tags.js";

export { display, parseTag };

type Account = {
  address: Address;
  signMessage: (payload: { message: string }) => Promise<`0x${string}`>;
};

/** Set once the service answers. Until then no tag control is offered. */
let available = false;
export const tagsAvailable = () => available;

/** Asked on launch. A failure leaves tags off rather than showing dead controls. */
export async function loadTagConfig() {
  try {
    const result = await api("/api/tags/config");
    available = Boolean(result.enabled);
  } catch {
    available = false;
  }
  return available;
}

/** The address a tag stands for. Throws if nobody holds it. */
export async function resolveTag(input: string) {
  const parsed = parseTag(input) as { ok: boolean; tag: string; reason: string };
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = await api("/api/tags/resolve", { tag: parsed.tag });
  if (!result.address)
    throw new Error(
      `No wallet holds ${display(parsed.tag)}. / 没有钱包持有 ${display(parsed.tag)}。`,
    );
  return { tag: parsed.tag, address: result.address as Address };
}

/** The tag this wallet holds, or null. Used to decide whether to ask for one. */
export async function tagOf(address: Address) {
  if (!available) return null;
  const result = await api(`/api/tags/by-address/${address}`);
  return (result.tag as string | null) ?? null;
}

/** Whether a name is still free. Shape is checked locally first, for the reason. */
export async function availability(input: string) {
  const parsed = parseTag(input) as { ok: boolean; tag: string; reason: string };
  if (!parsed.ok) return { tag: "", available: false, reason: parsed.reason };
  const result = await api(`/api/tags/available/${parsed.tag}`);
  return {
    tag: parsed.tag,
    available: Boolean(result.available),
    reason: result.reason || "",
  };
}

/**
 * Claim a name.
 *
 * Signed with the owner's key over the text `tags.js` builds — the same
 * builder the service verifies against, so what is signed and what is checked
 * cannot drift. The signature stops a claim being forged on the way; it does
 * not stop Tera rewriting the register later, and the claim screen says so.
 */
export async function claimTag(account: Account, input: string) {
  const parsed = parseTag(input) as { ok: boolean; tag: string; reason: string };
  if (!parsed.ok) throw new Error(parsed.reason);
  if (!API.startsWith("https://")) throw new Error("HTTPS is required.");

  const timestamp = Date.now();
  const message = claimMessage({ tag: parsed.tag, address: account.address, timestamp });
  const signature = await account.signMessage({ message });

  await api("/api/tags/claim", {
    tag: parsed.tag,
    owner: account.address,
    timestamp,
    signature,
  });
  return { tag: parsed.tag };
}
