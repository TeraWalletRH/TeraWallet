// ENS names on the send screen.
//
// A tag (tags.ts) and a business email (business/email.ts) are both names
// Tera's own register answers for. An ENS name is not: it is Ethereum
// mainnet's own name system, answered by ENS's own contracts on a network
// Robinhood Chain is not. Resolving one here changes nothing about Robinhood
// Chain or its contracts — it is a read-only lookup against a different
// chain's public nodes, exactly as a balance read is a lookup against
// Robinhood Chain's.
//
// Same rule as a tag: the resolved address is what a transfer is built from
// and what the review sheet shows, never the name. And the same caution a
// tag's file states for Tera's register applies here for ENS's: this wallet
// did not write the record being read, and has no second source to check it
// against beyond the address it shows before signing.

import { createPublicClient, fallback, http, type Address } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { ENS_RPCS } from "./config";

const client = createPublicClient({
  chain: mainnet,
  transport: fallback(ENS_RPCS.map((url) => http(url, { timeout: 8000, retryCount: 1 }))),
});

const ENS_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/;

/** Whether input reads as an ENS name rather than a tag, email or address. */
export function isEnsName(input: string) {
  return ENS_NAME.test(String(input ?? "").trim().toLowerCase());
}

export class EnsError extends Error {}

/** The address an ENS name resolves to. Throws if it has none. */
export async function resolveEns(input: string) {
  const text = String(input ?? "").trim().toLowerCase();
  if (!isEnsName(text)) throw new EnsError("Not an ENS name.");
  let name: string;
  try {
    name = normalize(text);
  } catch {
    throw new EnsError(`${text} is not a well-formed ENS name.`);
  }
  let address: Address | null;
  try {
    address = await client.getEnsAddress({ name });
  } catch {
    throw new EnsError("Could not reach Ethereum to look up that name. Try again.");
  }
  if (!address) throw new EnsError(`${name} is not registered, or has no address set.`);
  // Named `tag` to fit the send screen's lookup state, which shows it as typed.
  return { tag: name, address };
}
