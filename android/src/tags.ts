// Tags on the phone.
//
// The shared core holds the grammar and the EIP-712 struct; `tags-chain.js`
// holds the encoding. This file is the adapter between those and what this app
// already has — viem's public client for reads, the owner's unlocked account
// for the signature, and Tera's API for the relay that pays the gas.
//
// Two rules, the same ones the web wallet follows:
//
//   A recipient is read from the chain. The service's answer is fine for
//   suggesting names while the owner types; it is never what a transfer is
//   built from, because a wrong answer there would be shown beside a name the
//   owner trusts and an address they do not read.
//
//   A claim is signed here and relayed by Tera. The relayer pays gas so an
//   owner holding only USDG can still claim a name, and it cannot alter what
//   was signed — the registry verifies the owner's signature, not the sender's.

import { parseAbi, type Address } from "viem";
import { client } from "./network";
import { api } from "./api";
import { API, TAG_REGISTRY, chain, tagsAvailable } from "./config";
import { parseTag, display, claimTypedData } from "../../public/tera/core/tags.js";
import {
  resolveOnChain,
  tagOfOnChain,
  availableOnChain,
} from "../../public/tera/core/tags-chain.js";

export { display, parseTag, tagsAvailable };

const NONCES_ABI = parseAbi(["function nonces(address owner) view returns (uint256)"]);

/** How long a signed claim stays good for. Long enough to relay, short enough to matter. */
const CLAIM_WINDOW_SECONDS = 15 * 60;

/** An `eth_call` shaped the way the shared core expects. */
const call = async ({ to, data }: { to: string; data: string }) => {
  const result = await client.call({ to: to as Address, data: data as `0x${string}` });
  return result.data ?? "0x";
};

const registry = () => {
  if (!tagsAvailable()) throw new Error("This build has no tag registry. / 此版本未配置标签注册表。");
  return TAG_REGISTRY as Address;
};

/** The address a tag stands for, read from the registry. Throws if nobody holds it. */
export async function resolveTag(input: string) {
  const parsed = parseTag(input) as { ok: boolean; tag: string; reason: string };
  if (!parsed.ok) throw new Error(parsed.reason);
  const { address } = (await resolveOnChain({
    call,
    registry: registry(),
    tag: parsed.tag,
  })) as { address: string | null };
  if (!address)
    throw new Error(`No wallet holds ${display(parsed.tag)}. / 没有钱包持有 ${display(parsed.tag)}。`);
  return { tag: parsed.tag, address: address as Address };
}

/** The tag an owner holds, or null. Used to decide whether to ask them to claim one. */
export async function tagOf(address: Address) {
  if (!tagsAvailable()) return null;
  return (await tagOfOnChain({ call, registry: registry(), address })) as string | null;
}

/** Whether a name is still free. Shape is checked locally first, for the reason. */
export async function availability(input: string) {
  const parsed = parseTag(input) as { ok: boolean; tag: string; reason: string };
  if (!parsed.ok) return { tag: "", available: false, reason: parsed.reason };
  const free = (await availableOnChain({ call, registry: registry(), tag: parsed.tag })) as boolean;
  return {
    tag: parsed.tag,
    available: free,
    reason: free ? "" : "Taken, or too close to a tag that is. / 已被占用，或与已有标签过于相似。",
  };
}

/**
 * Sign a claim and ask Tera to submit it.
 *
 * The nonce comes from the registry rather than from the service, so a service
 * that wanted to replay an old signature could not choose which one. The
 * deadline is in seconds because the contract compares it to `block.timestamp`.
 */
export async function claimTag(
  account: { address: Address; signTypedData: (payload: never) => Promise<`0x${string}`> },
  input: string,
) {
  const parsed = parseTag(input) as { ok: boolean; tag: string; reason: string };
  if (!parsed.ok) throw new Error(parsed.reason);
  if (!API.startsWith("https://")) throw new Error("HTTPS is required.");

  const nonce = await client.readContract({
    address: registry(),
    abi: NONCES_ABI,
    functionName: "nonces",
    args: [account.address],
  });
  const deadline = Math.floor(Date.now() / 1000) + CLAIM_WINDOW_SECONDS;
  const typed = claimTypedData({
    tag: parsed.tag,
    owner: account.address,
    nonce: Number(nonce),
    deadline,
    chainId: chain.id,
    registry: registry(),
  });
  const signature = await account.signTypedData(typed as never);

  const result = await api("/api/tags/claim", {
    tag: parsed.tag,
    owner: account.address,
    deadline,
    signature,
  });
  return { tag: parsed.tag, txHash: result.txHash as `0x${string}` };
}
