// Tags, and who decides what one means.
//
// This service is the registry. A row in `tags` is the whole of the fact that
// `@astra` is an address, and there is nothing else to check it against.
//
// That is worth stating plainly, because it is the weak point of this design
// and the wallet's other answers do not work this way: a balance is read from
// the chain, a transfer is rebuilt locally from calldata, a receipt is checked
// against a published hash. A tag is none of those. If this database is wrong
// — edited, restored from a stale backup, or tampered with — a wallet asking
// "who is @astra" is told an address it cannot verify, and the owner sees a
// name they trust above forty characters they will not read.
//
// Three things follow, and each one is a rule below rather than a convention:
//
//   Every answer says where it came from. `source: "service"` goes out with
//   each resolution, and the surfaces print it. An owner should know they are
//   trusting Tera for this and not for a balance.
//
//   Claims are signed by the owner. This service cannot bind a name to an
//   address nobody asked it to: the claim carries a `personal_sign` over the
//   exact text in `tags.js`, recovered here, and a claim it cannot recover is
//   refused. It protects against a claim being forged in transit, not against
//   this service later rewriting the row it stored — nothing here can.
//
//   Nothing is resolved without a ledger. If the database is unreachable the
//   route says so, because "no such tag" and "we could not look" must not be
//   the same answer at a payment form.
//
// The address a transfer is built from is still the address, never the tag —
// see `validation.ts` on Android, which rebuilds calldata from what it was
// given and would not care if the name changed underneath it.

import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import pool from "./db";
import { env } from "./env";
import { claimMessage, parseTag, releaseMessage, skeleton } from "./tag-core";

/** How long a signed claim stays good for. Matches the deletion request window. */
const SIGNATURE_WINDOW_MS = 5 * 60_000;

export const enabled = () => Boolean(env.tagsEnabled && pool);

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

function owned(input: unknown) {
  must(
    typeof input === "string" && isAddress(input, { strict: false }),
    "A wallet address is required.",
  );
  return getAddress(input as string);
}

export function config() {
  return {
    enabled: enabled(),
    // Which of the two preconditions is missing, so "unavailable" can be
    // diagnosed from the response instead of from the deploy logs. Both are
    // booleans about this service's own configuration — no value, no secret,
    // and nothing an attacker learns that the 503 did not already tell them.
    requires: {
      flag: env.tagsEnabled,
      database: Boolean(pool),
    },
    chainId: env.rhcChainId,
    // Said in the config so a surface can show it before an owner claims
    // anything, not only in the small print of a resolution.
    authority:
      "Tera keeps the tag register. A tag is not an on-chain name: resolving one means trusting this service to answer honestly, unlike a balance or a receipt.",
    note: "A tag names one address on Robinhood Chain. It is not an address on any other chain, and it is public once claimed.",
  };
}

// --- Reading ------------------------------------------------------------------

export async function resolveTag(input: unknown) {
  const tag = canonical(input);
  must(pool, "The tag register is unavailable.");
  const found = await pool!.query("SELECT owner_address FROM tags WHERE tag=$1", [tag]);
  return {
    tag,
    address: found.rows[0] ? getAddress(found.rows[0].owner_address) : null,
    resolvedAt: new Date().toISOString(),
    source: "service" as const,
  };
}

export async function tagForAddress(input: unknown) {
  const address = owned(input);
  must(pool, "The tag register is unavailable.");
  const found = await pool!.query("SELECT tag FROM tags WHERE owner_address=$1", [address]);
  return { address, tag: found.rows[0]?.tag ?? null, source: "service" as const };
}

export async function availability(input: unknown) {
  // Shape first: it is free, and it names the specific problem rather than
  // answering a bare "unavailable".
  const parsed = parseTag(input);
  if (!parsed.ok) return { tag: null, available: false, reason: parsed.reason };
  must(pool, "The tag register is unavailable.");
  const clash = await pool!.query("SELECT tag FROM tags WHERE tag=$1 OR skeleton=$2", [
    parsed.tag,
    skeleton(parsed.tag),
  ]);
  const free = clash.rowCount === 0;
  return {
    tag: parsed.tag,
    available: free,
    reason: free ? "" : "This tag, or one that reads like it, is already taken.",
    source: "service" as const,
  };
}

export async function searchTags(prefix: unknown, limit = 10) {
  must(pool, "The tag register is unavailable.");
  const parsed = String(prefix ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,19}$/.test(parsed)) return { tags: [], source: "service" as const };
  const rows = await pool!.query(
    "SELECT tag, owner_address FROM tags WHERE tag LIKE $1 ORDER BY LENGTH(tag), tag LIMIT $2",
    [`${parsed}%`, Math.min(Math.max(Number(limit) || 10, 1), 25)],
  );
  return {
    tags: rows.rows.map((row) => ({ tag: row.tag, address: getAddress(row.owner_address) })),
    source: "service" as const,
  };
}

// --- Writing --------------------------------------------------------------------

/**
 * Recover the signer of a claim, or refuse.
 *
 * The message is rebuilt here from the tag and address this service is about
 * to act on — never taken from the request — so a signature over some other
 * text cannot be replayed to bind a name the owner did not agree to.
 */
async function signedBy(
  message: string,
  address: `0x${string}`,
  signature: unknown,
  timestamp: number,
) {
  must(
    typeof signature === "string" && /^0x[\da-fA-F]{130}$/.test(signature),
    "A wallet signature is required.",
  );
  must(
    Number.isSafeInteger(timestamp) && Math.abs(Date.now() - timestamp) < SIGNATURE_WINDOW_MS,
    "This request has expired. Sign a new one and try again.",
  );
  let valid = false;
  try {
    valid = await verifyMessage({ address, message, signature: signature as Hex });
  } catch {
    valid = false;
  }
  must(valid, "That signature did not match this wallet.");
}

/**
 * Bind a name to an address.
 *
 * One tag per address: claiming a second releases the first in the same
 * transaction, so an owner changing name never ends up holding two or none.
 * The skeleton column carries the uniqueness constraint for lookalikes, which
 * makes the collision the database's job rather than a check to remember.
 */
export async function claimTag(body: {
  tag?: unknown;
  owner?: unknown;
  timestamp?: unknown;
  signature?: unknown;
}) {
  must(enabled(), "Tags are unavailable.");
  const tag = canonical(body.tag);
  const owner = owned(body.owner);
  const timestamp = Number(body.timestamp);
  await signedBy(
    claimMessage({ tag, address: owner, timestamp }),
    owner,
    body.signature,
    timestamp,
  );

  const db = await pool!.connect();
  try {
    await db.query("BEGIN");
    const clash = await db.query(
      "SELECT tag, owner_address FROM tags WHERE (tag=$1 OR skeleton=$2) AND owner_address<>$3",
      [tag, skeleton(tag), owner],
    );
    if (clash.rowCount) {
      throw new TagServiceError("This tag, or one that reads like it, is already taken.");
    }
    // The previous name goes back to the pool in the same transaction, so a
    // failure here cannot leave the owner with neither.
    await db.query("DELETE FROM tags WHERE owner_address=$1", [owner]);
    await db.query(
      "INSERT INTO tags(tag, skeleton, owner_address, claimed_at, updated_at) VALUES($1,$2,$3,NOW(),NOW())",
      [tag, skeleton(tag), owner],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
  return { tag, owner, claimedAt: new Date().toISOString() };
}

/** Give a tag up, returning the name and its lookalikes to the pool. */
export async function releaseTag(body: {
  tag?: unknown;
  owner?: unknown;
  timestamp?: unknown;
  signature?: unknown;
}) {
  must(enabled(), "Tags are unavailable.");
  const tag = canonical(body.tag);
  const owner = owned(body.owner);
  const timestamp = Number(body.timestamp);
  await signedBy(
    releaseMessage({ tag, address: owner, timestamp }),
    owner,
    body.signature,
    timestamp,
  );
  const gone = await pool!.query("DELETE FROM tags WHERE tag=$1 AND owner_address=$2", [
    tag,
    owner,
  ]);
  must(gone.rowCount, "This wallet does not hold that tag.");
  return { tag, owner, released: true };
}
