// Tags, from the service's side.
//
// The registry is the contract. This file reads it, relays claims into it, and
// keeps a table that mirrors it — and the ordering of those three matters:
//
//   A resolve is answered from the chain, every time. The index is never
//   consulted for "which address is @astra", because an index that lags by one
//   block would answer with the previous owner of a name, and the one thing
//   this service must not do is name the wrong recipient. If the RPC is
//   unreachable the route says so rather than falling back.
//
//   The index exists for the questions where being a little stale is harmless:
//   prefix search, and listing. Everything it returns is labelled as coming
//   from the index.
//
//   Relaying is a favour, not an authority. `claimFor` carries the owner's
//   EIP-712 signature, so the most this service can do is decline to pay the
//   gas. It cannot choose the name, the address, or the moment — and a claim
//   is simulated before it is sent, so a signature that would revert costs
//   nothing.

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import pool from "./db";
import { env } from "./env";
import { parseTag, skeleton } from "../../public/tera/core/tags.js";

export const REGISTRY_ABI = parseAbi([
  "function resolve(string tag) view returns (address)",
  "function tagOf(address owner) view returns (string)",
  "function available(string tag) view returns (bool)",
  "function isReserved(string tag) view returns (bool)",
  "function nonces(address owner) view returns (uint256)",
  "function claimFor(string tag, address owner, uint256 deadline, bytes signature)",
  "function releaseFor(address owner, uint256 deadline, bytes signature)",
  "event TagClaimed(bytes32 indexed tagHash, address indexed owner, string tag)",
  "event TagReleased(bytes32 indexed tagHash, address indexed owner, string tag)",
]);

const CLAIMED = parseAbiItem(
  "event TagClaimed(bytes32 indexed tagHash, address indexed owner, string tag)",
);
const RELEASED = parseAbiItem(
  "event TagReleased(bytes32 indexed tagHash, address indexed owner, string tag)",
);

/** Blocks per indexing pass. Bounded so a cold start cannot ask for the chain in one call. */
const INDEX_WINDOW = 2_000n;

/** Relayed claims allowed per wallet per day. A rename is legitimate; forty are not. */
const RELAY_DAILY_LIMIT = 3;

const client = createPublicClient({
  transport: http(env.rhcRpcUrl, { timeout: 10_000, retryCount: 1 }),
});

const isAddressLike = (value: string) => /^0x[\da-fA-F]{40}$/.test(value);
const isKey = (value: string) => /^0x[\da-fA-F]{64}$/.test(value);

/** Reading works with just an address; relaying additionally needs a funded key. */
export const enabled = () => env.tagsEnabled && isAddressLike(env.tagRegistryAddress);
export const relayEnabled = () => enabled() && isKey(env.tagRelayerPrivateKey);

const registry = () => getAddress(env.tagRegistryAddress);
const relayer = () => privateKeyToAccount(env.tagRelayerPrivateKey as Hex);

export class TagServiceError extends Error {}

const must = (condition: unknown, message: string) => {
  if (!condition) throw new TagServiceError(message);
};

/** The canonical tag, or a refusal carrying the reason the owner should see. */
function canonical(input: unknown) {
  const parsed = parseTag(input);
  must(parsed.ok, parsed.reason);
  return parsed.tag as string;
}

export function config() {
  return {
    enabled: enabled(),
    relayEnabled: relayEnabled(),
    registry: enabled() ? registry() : null,
    chainId: env.rhcChainId,
    note: "A tag names one address on Robinhood Chain. It is not an address on any other chain, and it is public once claimed.",
  };
}

// --- Reading, always from the chain ------------------------------------------

export async function resolveTag(input: unknown) {
  const tag = canonical(input);
  const address = await client.readContract({
    address: registry(),
    abi: REGISTRY_ABI,
    functionName: "resolve",
    args: [tag],
  });
  const blockNumber = await client.getBlockNumber();
  return {
    tag,
    address: address === "0x0000000000000000000000000000000000000000" ? null : getAddress(address),
    // Both returned so a receipt can record what a name meant and when. A tag
    // can be released and re-claimed, which makes an undated resolution a
    // claim about the present tense only.
    blockNumber: blockNumber.toString(),
    resolvedAt: new Date().toISOString(),
    source: "chain" as const,
  };
}

export async function tagForAddress(input: unknown) {
  must(typeof input === "string" && isAddressLike(input), "A wallet address is required.");
  const owner = getAddress(input as string);
  const tag = await client.readContract({
    address: registry(),
    abi: REGISTRY_ABI,
    functionName: "tagOf",
    args: [owner],
  });
  return { address: owner, tag: tag || null, source: "chain" as const };
}

export async function availability(input: unknown) {
  // Shape first: it is free, and it gives the owner the specific reason rather
  // than a bare "unavailable" from a contract that cannot explain itself.
  const parsed = parseTag(input);
  if (!parsed.ok) return { tag: null, available: false, reason: parsed.reason };
  const free = await client.readContract({
    address: registry(),
    abi: REGISTRY_ABI,
    functionName: "available",
    args: [parsed.tag],
  });
  return {
    tag: parsed.tag,
    available: free,
    reason: free ? "" : "This tag, or one that reads like it, is already taken.",
    source: "chain" as const,
  };
}

export async function nonceOf(input: unknown) {
  must(typeof input === "string" && isAddressLike(input), "A wallet address is required.");
  const owner = getAddress(input as string);
  const nonce = await client.readContract({
    address: registry(),
    abi: REGISTRY_ABI,
    functionName: "nonces",
    args: [owner],
  });
  return { address: owner, nonce: Number(nonce), chainId: env.rhcChainId, registry: registry() };
}

// --- Relaying ----------------------------------------------------------------

async function withinRelayLimit(owner: Address) {
  if (!pool) return;
  const used = await pool.query(
    "SELECT COUNT(*)::int AS count FROM tag_claim_relays WHERE owner_address=$1 AND created_at > NOW() - INTERVAL '1 day'",
    [owner],
  );
  must(
    (used.rows[0]?.count ?? 0) < RELAY_DAILY_LIMIT,
    "This wallet has used its relayed claims for today. Claim from the wallet directly, or try again tomorrow.",
  );
}

/**
 * Submit somebody else's signed claim and pay for it.
 *
 * Simulated first. A bad signature, a taken name or a passed deadline then
 * costs a failed read instead of a reverted transaction, and the caller gets
 * the contract's own error rather than a hash to go and look up.
 */
export async function relayClaim(body: {
  tag?: unknown;
  owner?: unknown;
  deadline?: unknown;
  signature?: unknown;
}) {
  must(relayEnabled(), "Relayed claims are unavailable.");
  const tag = canonical(body.tag);
  must(typeof body.owner === "string" && isAddressLike(body.owner), "A wallet address is required.");
  const owner = getAddress(body.owner as string);
  const deadline = Number(body.deadline);
  must(Number.isSafeInteger(deadline) && deadline > 0, "A deadline in seconds is required.");
  must(
    deadline > Math.floor(Date.now() / 1000),
    "This claim has expired. Sign a new one and try again.",
  );
  must(
    typeof body.signature === "string" && /^0x[\da-fA-F]+$/.test(body.signature),
    "A signature is required.",
  );
  const signature = body.signature as Hex;

  await withinRelayLimit(owner);

  const account = relayer();
  const { request } = await client.simulateContract({
    account,
    address: registry(),
    abi: REGISTRY_ABI,
    functionName: "claimFor",
    args: [tag, owner, BigInt(deadline), signature],
  });

  const wallet = createWalletClient({ account, transport: http(env.rhcRpcUrl) });
  const txHash = await wallet.writeContract(request);

  if (pool) {
    await pool.query(
      "INSERT INTO tag_claim_relays(owner_address,tag,tx_hash) VALUES($1,$2,$3)",
      [owner, tag, txHash],
    );
  }
  return { tag, owner, txHash, paidBy: account.address };
}

// --- The index ---------------------------------------------------------------

export async function searchTags(prefix: unknown, limit = 10) {
  if (!pool) return { tags: [], source: "index" as const };
  const parsed = String(prefix ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,19}$/.test(parsed)) return { tags: [], source: "index" as const };
  const rows = await pool.query(
    "SELECT tag, owner_address FROM tags WHERE tag LIKE $1 ORDER BY LENGTH(tag), tag LIMIT $2",
    [`${parsed}%`, Math.min(Math.max(Number(limit) || 10, 1), 25)],
  );
  return {
    tags: rows.rows.map((row) => ({ tag: row.tag, address: getAddress(row.owner_address) })),
    // Said out loud on every response: a name found here still has to be
    // resolved against the chain before anything is sent to it.
    source: "index" as const,
    note: "From Tera's index, which can lag the chain. Resolve before sending.",
  };
}

/**
 * Bring the table up to the chain.
 *
 * Events are applied strictly in log order, which is what makes a rename
 * correct: the contract emits the release before the claim, so replaying them
 * out of order would leave the old name pointing at a live owner.
 */
export async function syncTagIndex() {
  if (!enabled() || !pool) return { synced: false as const };
  const cursor = await pool.query("SELECT last_block FROM tag_index_cursor WHERE id = TRUE");
  const head = await client.getBlockNumber();
  const last = BigInt(cursor.rows[0]?.last_block ?? 0);
  const from = last + 1n;
  if (from > head) return { synced: true as const, applied: 0, caughtUp: true as const };
  const to = from + INDEX_WINDOW - 1n > head ? head : from + INDEX_WINDOW - 1n;

  const logs = await client.getLogs({
    address: registry(),
    events: [CLAIMED, RELEASED],
    fromBlock: from,
    toBlock: to,
  });
  logs.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? Number(a.logIndex) - Number(b.logIndex)
      : Number(a.blockNumber! - b.blockNumber!),
  );

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const log of logs) {
      const parsed = log as unknown as {
        eventName: string;
        args: { owner: Address; tag: string };
        blockNumber: bigint;
        logIndex: number;
        transactionHash: Hex;
      };
      const tag = String(parsed.args?.tag ?? "");
      if (!tag) continue;
      if (parsed.eventName === "TagReleased") {
        await db.query("DELETE FROM tags WHERE tag=$1", [tag]);
        continue;
      }
      const owner = getAddress(parsed.args.owner);
      // A wallet holds one tag, so an older row for the same owner is gone by
      // definition — the contract released it in the same transaction.
      await db.query("DELETE FROM tags WHERE owner_address=$1", [owner]);
      await db.query(
        `INSERT INTO tags(tag,skeleton,owner_address,block_number,log_index,tx_hash)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tag) DO UPDATE SET owner_address=EXCLUDED.owner_address,
           block_number=EXCLUDED.block_number, log_index=EXCLUDED.log_index,
           tx_hash=EXCLUDED.tx_hash, updated_at=NOW()`,
        [tag, skeleton(tag), owner, parsed.blockNumber.toString(), parsed.logIndex, parsed.transactionHash],
      );
    }
    await db.query("UPDATE tag_index_cursor SET last_block=$1, updated_at=NOW() WHERE id = TRUE", [
      to.toString(),
    ]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
  return { synced: true as const, applied: logs.length, caughtUp: to >= head };
}

let indexing = false;

export function startTagIndexer() {
  if (!enabled() || !pool) return;
  const tick = async () => {
    if (indexing) return;
    indexing = true;
    try {
      // Keep going while a cold start is still behind the head, but bounded:
      // a chain this service cannot catch up with in one interval should fall
      // behind visibly rather than spin.
      for (let pass = 0; pass < 25; pass += 1) {
        const result = await syncTagIndex();
        if (!result.synced || result.caughtUp) break;
      }
    } catch (error) {
      console.error("Tag index sync failed", error);
    } finally {
      indexing = false;
    }
  };
  void tick();
  setInterval(() => void tick(), env.tagIndexIntervalMs).unref();
}
