// Team treasuries: who is on a team, and the queue of payments they approve.
//
// The treasury is a Safe, and the Safe is the authority on the only question
// that moves money — whose signatures count. This service never holds a key
// and cannot execute anything; it keeps what the chain does not: the member
// list with roles, invitations, and proposals collecting signatures until
// enough signers have approved one for anybody to execute it.
//
// Two rules keep that honest:
//
//   Everything is checked against the chain, not remembered. Who can approve
//   is read from the Safe's owner list on every request; a proposal's hash is
//   computed here and compared with the Safe's own getTransactionHash before
//   it is stored; "executed" is taken from a receipt or the Safe's nonce.
//
//   Every write is signed by the member making it, over text rebuilt here from
//   what is about to happen (core/teams.js), and a read is signed too, because
//   a team's queue says who it pays and why.
//
// The queue, and why it is shaped this way. A Safe runs transactions strictly
// by nonce, and an approval is a signature over one nonce. So:
//
//   A proposal takes a nonce at its first approval, not when it is made. One
//   nobody has signed holds no place, and withdrawing it disturbs nothing.
//
//   Rejecting a placed proposal signs the Safe's empty transaction at the same
//   nonce. Once enough signers have, sending it uses the nonce up doing
//   nothing, and every later proposal keeps its place and its approvals. The
//   same path serves an on-chain cancel. Only "cancel now" closes the gap
//   instead — free, but everything after moves down and must be re-approved.
//
//   A signer change is written when its place is known, from the owner list
//   as it will stand after everything queued ahead of it (reconcile() below).
//   If the list moves anyway — a change ahead was cancelled, or someone used
//   another Safe app — it is rebuilt, or closed if it no longer makes sense.

import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  http,
  isAddress,
  parseAbi,
  recoverTypedDataAddress,
  verifyMessage,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { parseEmail } from "./business-email-core";
import pool from "./db";
import { env } from "./env";
import {
  actionMessage,
  can,
  cleanText,
  isSignerRole,
  majority,
  MAX_NOTE,
  MAX_TEAM_NAME,
  ROLES,
  SAFE,
  safeTxTypedData,
  EXPIRATION_PRESETS,
  parseExpirationSeconds,
  isProposalExpired,
  remainingSeconds,
  type Role,
} from "./teams-core";

const SIGNATURE_WINDOW_MS = 5 * 60_000;
export const SENTINEL = "0x0000000000000000000000000000000000000001" as Address;

export class TeamServiceError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

const must = (condition: unknown, message: string, status = 422) => {
  if (!condition) throw new TeamServiceError(message, status);
};

export const enabled = () => Boolean(env.teamsEnabled && pool);

export function config() {
  return {
    enabled: enabled(),
    requires: { flag: env.teamsEnabled, database: Boolean(pool) },
    chainId: env.rhcChainId,
    safe: SAFE,
    roles: ROLES,
    expirationPresets: EXPIRATION_PRESETS,
    authority:
      "The treasury is a Safe: only its signers' approvals can move money, checked by the contract. Tera keeps the member list and the approval queue, and cannot execute anything.",
  };
}

// --- Signer changes, worked out ------------------------------------------------

export type Change =
  | { kind: "add-signer" | "remove-signer"; subject: Address }
  | { kind: "threshold"; rule: number | null };

/**
 * The team's approval rule: a fixed number of approvals, or null for "more
 * than half". A fixed number never asks for more signers than exist.
 */
export const thresholdFor = (signers: number, rule: number | null) =>
  rule ? Math.max(1, Math.min(rule, signers)) : majority(signers);

/**
 * The owner list after a change, as the Safe itself would leave it: a new
 * owner goes to the head of its linked list, a removed one drops out.
 */
export function applyChange(owners: Address[], change: Change): Address[] {
  if (change.kind === "threshold") return owners;
  return change.kind === "add-signer"
    ? [change.subject, ...owners.filter((o) => o !== change.subject)]
    : owners.filter((o) => o !== change.subject);
}

/**
 * The call arguments for a change against a given owner list and approval
 * rule, or null when it no longer makes sense there (adding a current signer,
 * removing a non-signer, or removing the last one). Adding or removing a
 * signer keeps the team's rule: a majority stays a majority, and a fixed
 * number stays fixed as far as there are signers to meet it.
 */
export function changeArgs(owners: Address[], change: Change, rule: number | null = null) {
  if (change.kind === "threshold")
    return {
      functionName: "changeThreshold" as const,
      args: [BigInt(thresholdFor(owners.length, change.rule))] as const,
    };
  if (change.kind === "add-signer") {
    if (owners.includes(change.subject)) return null;
    return {
      functionName: "addOwnerWithThreshold" as const,
      args: [change.subject, BigInt(thresholdFor(owners.length + 1, rule))] as const,
    };
  }
  const index = owners.indexOf(change.subject);
  if (index < 0 || owners.length < 2) return null;
  return {
    functionName: "removeOwner" as const,
    args: [
      index === 0 ? SENTINEL : owners[index - 1],
      change.subject,
      BigInt(thresholdFor(owners.length - 1, rule)),
    ] as const,
  };
}

/** The rule in force after a change. */
export const ruleAfter = (rule: number | null, change: Change) =>
  change.kind === "threshold" ? change.rule : rule;

const rowChange = (row: { kind: string; subject: string | null; rule: number | null }): Change =>
  row.kind === "threshold"
    ? { kind: "threshold", rule: row.rule ? Number(row.rule) : null }
    : ({ kind: row.kind, subject: getAddress(String(row.subject)) } as Change);

// --- The chain ------------------------------------------------------------------

const client = createPublicClient({ transport: http(env.rhcRpcUrl, { timeout: 20_000 }) });

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function addOwnerWithThreshold(address owner, uint256 _threshold)",
  "function removeOwner(address prevOwner, address owner, uint256 _threshold)",
  "function changeThreshold(uint256 _threshold)",
]);

const encodeChange = (owners: Address[], change: Change, rule: number | null) => {
  const call = changeArgs(owners, change, rule);
  return call ? (encodeFunctionData({ abi: safeAbi, ...call } as never) as Hex) : null;
};

/** Refuse anything that is not a Safe v1.4.1 proxy: its owner list is what we trust. */
async function assertSafe(safe: Address) {
  const code = await client.getCode({ address: safe });
  must(code && code !== "0x", "There is no contract at that address on Robinhood Chain.");
  const slot = await client.getStorageAt({ address: safe, slot: "0x0" });
  const singleton = `0x${String(slot).slice(-40)}`.toLowerCase();
  must(
    singleton === SAFE.singletonL2.toLowerCase() || singleton === SAFE.singleton.toLowerCase(),
    "That address is not a Safe this app supports (Safe v1.4.1).",
  );
}

async function onChain(safe: Address) {
  const [owners, threshold, nonce] = await Promise.all([
    client.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
  ]);
  return {
    owners: owners.map((owner) => getAddress(owner)),
    threshold: Number(threshold),
    nonce,
  };
}
type ChainState = Awaited<ReturnType<typeof onChain>>;

async function hashFor(safe: Address, to: Address, value: bigint, data: Hex, nonce: bigint) {
  const hash = hashTypedData(
    safeTxTypedData({ safe, chainId: env.rhcChainId, to, value, data, nonce }) as never,
  );
  // The Safe's own answer, so a mistake in our encoding is caught here rather
  // than as a signature the contract later refuses.
  const theirs = await client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getTransactionHash",
    args: [to, value, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, nonce],
  });
  must(theirs.toLowerCase() === hash.toLowerCase(), "The Safe disagreed about this transaction.");
  return hash;
}

async function recoverSafeTx(
  safe: Address,
  fields: { to: Address; value: bigint; data: Hex; nonce: bigint },
  signature: unknown,
) {
  if (typeof signature !== "string" || !/^0x[\da-fA-F]{130}$/.test(signature)) return null;
  const typed = safeTxTypedData({ safe, chainId: env.rhcChainId, ...fields });
  try {
    return await recoverTypedDataAddress({
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
      signature: signature as Hex,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
  } catch {
    return null;
  }
}

// --- Requests -------------------------------------------------------------------

const address = (input: unknown, what = "A wallet address") => {
  must(typeof input === "string" && isAddress(input, { strict: false }), `${what} is required.`);
  return getAddress(input as string);
};

/** Check that `body.wallet` signed exactly this action, and return the wallet. */
async function signed(
  action: string,
  team: string,
  body: Record<string, unknown>,
  fields: [string, unknown][] = [],
) {
  const wallet = address(body.wallet);
  const timestamp = Number(body.timestamp);
  must(
    Number.isSafeInteger(timestamp) && Math.abs(Date.now() - timestamp) < SIGNATURE_WINDOW_MS,
    "This request has expired. Sign a new one and try again.",
  );
  must(
    typeof body.signature === "string" && /^0x[\da-fA-F]{130}$/.test(body.signature),
    "A wallet signature is required.",
  );
  let valid = false;
  try {
    valid = await verifyMessage({
      address: wallet,
      message: actionMessage({ action, team, wallet, timestamp, fields }),
      signature: body.signature as Hex,
    });
  } catch {
    valid = false;
  }
  must(valid, "That signature did not match this wallet.");
  return wallet;
}

type Member = { address: Address; role: Role; status: "invited" | "active" };

async function memberOf(safe: Address, wallet: Address): Promise<Member | null> {
  const found = await pool!.query(
    "SELECT address, role, status FROM team_members WHERE safe_address=$1 AND address=$2",
    [safe, wallet],
  );
  const row = found.rows[0];
  return row ? { address: getAddress(row.address), role: row.role, status: row.status } : null;
}

async function requireTeam(input: unknown) {
  const safe = address(input, "The team");
  const found = await pool!.query("SELECT safe_address FROM teams WHERE safe_address=$1", [safe]);
  must(found.rowCount, "Tera has no team for that treasury.", 404);
  return safe;
}

async function requireAbility(safe: Address, wallet: Address, action: string) {
  const member = await memberOf(safe, wallet);
  must(
    member && member.status === "active",
    "This wallet is not an active member of the team.",
    403,
  );
  must(can(member!.role, action), `A ${member!.role} cannot do that on this team.`, 403);
  return member!;
}

async function resolveMember(input: unknown) {
  const text = String(input ?? "").trim();
  if (isAddress(text, { strict: false })) return getAddress(text);
  const parsed = parseEmail(text);
  must(parsed.ok, "Enter a wallet address or a linked business email.");
  const found = await pool!.query("SELECT owner_address FROM business_emails WHERE email=$1", [
    parsed.email,
  ]);
  must(found.rowCount, `No Tera Business wallet is linked to ${parsed.email}.`);
  return getAddress(found.rows[0].owner_address);
}

/** How a member's text is written into what they sign: an address in lower case, or the email. */
export const memberField = (input: unknown) => {
  const text = String(input ?? "").trim();
  if (isAddress(text, { strict: false })) return text.toLowerCase();
  const parsed = parseEmail(text);
  return parsed.ok ? parsed.email : text;
};

// --- The queue ------------------------------------------------------------------

type Db = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

async function transaction<T>(work: (db: Db) => Promise<T>) {
  const db = await pool!.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db as unknown as Db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

/** One writer per team at a time: places in the queue are handed out in order. */
async function lockTeam(db: Db, safe: Address) {
  await db.query("SELECT safe_address FROM teams WHERE safe_address=$1 FOR UPDATE", [safe]);
}

const pendingPlaced = (db: Db, safe: Address) =>
  db
    .query(
      "SELECT * FROM team_proposals WHERE safe_address=$1 AND status='pending' AND nonce IS NOT NULL ORDER BY nonce",
      [safe],
    )
    .then((result) => result.rows);

/** How many of a proposal's rejections come from current signers. */
async function rejectionsFrom(db: Db, id: string, owners: Address[]) {
  const votes = await db.query(
    "SELECT signer FROM team_signatures WHERE proposal_id=$1 AND rejected",
    [id],
  );
  return votes.rows.filter((vote) => owners.includes(getAddress(vote.signer))).length;
}

/**
 * Bring the queue in line with the chain. Proposals whose nonce the Safe has
 * used are closed; placed signer changes are rewritten against the owner list
 * as it will stand when they run, and closed if they no longer make sense.
 * Returns the chain state, and the owner list at the end of the queue.
 */
async function reconcile(db: Db, safe: Address) {
  const state = await onChain(safe);
  // Used nonces. Which transaction used one is only known for sure from the
  // receipt the executing app reports; lacking that, enough rejections mean
  // the cancellation ran, and otherwise the proposal itself did.
  const passed = await db.query(
    "SELECT id, kind, rule FROM team_proposals WHERE safe_address=$1 AND status='pending' AND nonce IS NOT NULL AND nonce < $2 ORDER BY nonce",
    [safe, state.nonce.toString()],
  );
  for (const row of passed.rows) {
    const rejected = (await rejectionsFrom(db, row.id, state.owners)) >= state.threshold;
    await db.query("UPDATE team_proposals SET status=$2, closed_at=NOW() WHERE id=$1", [
      row.id,
      rejected ? "rejected" : "executed",
    ]);
    if (!rejected && row.kind === "threshold") await adoptRule(db, safe, row.rule);
  }
  // Expired proposals: auto-transition pending proposals whose expiration deadline has passed.
  const expired = await db.query(
    "SELECT id, nonce FROM team_proposals WHERE safe_address=$1 AND status='pending' AND expires_at IS NOT NULL AND expires_at <= NOW() ORDER BY nonce NULLS LAST",
    [safe],
  );
  for (const exp of expired.rows) {
    await db.query("UPDATE team_proposals SET status='expired', closed_at=NOW() WHERE id=$1", [
      exp.id,
    ]);
    if (exp.nonce !== null && exp.nonce !== undefined) {
      await closeGap(db, safe, BigInt(exp.nonce));
    }
  }
  const team = await db.query("SELECT approval_rule FROM teams WHERE safe_address=$1", [safe]);
  const startRule: number | null = team.rows[0]?.approval_rule
    ? Number(team.rows[0].approval_rule)
    : null;
  let owners = state.owners;
  let rule = startRule;
  let restart = true;
  while (restart) {
    restart = false;
    owners = state.owners;
    rule = startRule;
    for (const row of await pendingPlaced(db, safe)) {
      if (row.kind === "payment") continue;
      const change = rowChange(row);
      const data = encodeChange(owners, change, rule);
      if (!data) {
        // Nothing left to do (they were already added, or already gone).
        await db.query(
          "UPDATE team_proposals SET status='cancelled', closed_at=NOW() WHERE id=$1",
          [row.id],
        );
        await closeGap(db, safe, BigInt(row.nonce));
        restart = true;
        break;
      }
      if (data.toLowerCase() !== String(row.data).toLowerCase()) {
        const hash = await hashFor(safe, safe, 0n, data, BigInt(row.nonce));
        await db.query(
          "UPDATE team_proposals SET data=$2, safe_tx_hash=$3, rebuilt_at=NOW() WHERE id=$1",
          [row.id, data, hash],
        );
        await db.query("DELETE FROM team_signatures WHERE proposal_id=$1", [row.id]);
      }
      owners = applyChange(owners, change);
      rule = ruleAfter(rule, change);
    }
  }
  const top = await db.query(
    "SELECT MAX(nonce) AS top FROM team_proposals WHERE safe_address=$1 AND status='pending'",
    [safe],
  );
  const last = top.rows[0]?.top;
  const nextNonce =
    last !== null && last !== undefined && BigInt(last) + 1n > state.nonce
      ? BigInt(last) + 1n
      : state.nonce;
  return { state, ownersAtEnd: owners, ruleAtEnd: rule, rule: startRule, nextNonce };
}

/** The rule a team keeps once a threshold change has run (0 or null: majority). */
async function adoptRule(db: Db, safe: Address, rule: unknown) {
  await db.query("UPDATE teams SET approval_rule=$2 WHERE safe_address=$1", [
    safe,
    rule ? Number(rule) : null,
  ]);
}

/**
 * Close a gap left by "cancel now". Everything placed after it moves down one
 * nonce, and its approvals are cleared: they were signatures over the old one.
 * Signer changes among them are rewritten by the next reconcile().
 */
async function closeGap(db: Db, safe: Address, removed: bigint) {
  const later = await db.query(
    "SELECT id, to_address, value, data, nonce, kind FROM team_proposals WHERE safe_address=$1 AND status='pending' AND nonce > $2 ORDER BY nonce",
    [safe, removed.toString()],
  );
  for (const row of later.rows) {
    const nonce = BigInt(row.nonce) - 1n;
    const hash = await hashFor(
      safe,
      getAddress(row.to_address),
      BigInt(row.value),
      row.data,
      nonce,
    );
    await db.query("UPDATE team_proposals SET nonce=$2, safe_tx_hash=$3 WHERE id=$1", [
      row.id,
      nonce.toString(),
      hash,
    ]);
    await db.query("DELETE FROM team_signatures WHERE proposal_id=$1", [row.id]);
  }
}

/** The calldata a proposal would be signed with if it took the next place now. */
function fieldsAt(row: any, ownersAtEnd: Address[], ruleAtEnd: number | null, safe: Address) {
  if (row.kind === "payment" || row.data)
    return { to: getAddress(row.to_address), value: BigInt(row.value), data: row.data as Hex };
  const data = encodeChange(ownersAtEnd, rowChange(row), ruleAtEnd);
  return data ? { to: safe, value: 0n, data } : null;
}

/**
 * Queue a signer change. It has no calldata or place yet — both are settled
 * at its first approval. One pending change per signer, so two changes to the
 * same person can never undercut each other.
 */
async function queueChange(db: Db, safe: Address, change: Change, by: Address) {
  if (change.kind === "threshold") throw new Error("Use queueRule for the approval rule.");
  const clash = await db.query(
    "SELECT 1 FROM team_proposals WHERE safe_address=$1 AND status='pending' AND subject=$2",
    [safe, change.subject],
  );
  if (clash.rowCount) return null;
  const { ownersAtEnd, ruleAtEnd } = await reconcile(db, safe);
  if (!changeArgs(ownersAtEnd, change, ruleAtEnd)) return null;
  const inserted = await db.query(
    `INSERT INTO team_proposals(safe_address, kind, subject, to_address, value, note, created_by)
     VALUES($1,$2,$3,$1,0,$4,$5) RETURNING id`,
    [
      safe,
      change.kind,
      change.subject,
      `${change.kind === "add-signer" ? "Add" : "Remove"} ${change.subject} as a signer`,
      by,
    ],
  );
  return { id: String(inserted.rows[0].id) };
}

/**
 * Make the queue point one way for a signer: keep a pending change that
 * already does `want`, withdraw one that does the opposite (closing its gap if
 * it had a place), then queue `want` if the Safe still needs it.
 */
async function steerSigner(
  db: Db,
  safe: Address,
  who: Address,
  want: "add-signer" | "remove-signer",
  by: Address,
) {
  const found = await db.query(
    "SELECT id, kind, nonce FROM team_proposals WHERE safe_address=$1 AND status='pending' AND subject=$2",
    [safe, who],
  );
  const pending = found.rows[0];
  if (pending?.kind === want) return { id: String(pending.id) };
  if (pending) {
    await db.query("UPDATE team_proposals SET status='cancelled', closed_at=NOW() WHERE id=$1", [
      pending.id,
    ]);
    if (pending.nonce !== null) await closeGap(db, safe, BigInt(pending.nonce));
  }
  return queueChange(db, safe, { kind: want, subject: who }, by);
}

// --- Reading -------------------------------------------------------------------

export async function myTeams(body: Record<string, unknown>) {
  const wallet = await signed("read", "*", body);
  const rows = await pool!.query(
    `SELECT t.safe_address, t.name, m.role, m.status, m.invited_by
       FROM team_members m JOIN teams t ON t.safe_address = m.safe_address
      WHERE m.address=$1 ORDER BY t.created_at`,
    [wallet],
  );
  return {
    wallet,
    teams: rows.rows.map((row) => ({
      safe: getAddress(row.safe_address),
      name: row.name,
      role: row.role,
      status: row.status,
      invitedBy: row.invited_by ? getAddress(row.invited_by) : null,
    })),
  };
}

export async function viewTeam(body: Record<string, unknown>) {
  const safe = await requireTeam(body.team);
  const wallet = await signed("read", safe, body);
  const you = await requireAbility(safe, wallet, "view");
  const { state, ownersAtEnd, ruleAtEnd, rule, nextNonce } = await transaction(async (db) => {
    await lockTeam(db, safe);
    return reconcile(db, safe);
  });
  const [team, members, proposals] = await Promise.all([
    pool!.query("SELECT name, created_by FROM teams WHERE safe_address=$1", [safe]),
    pool!.query(
      "SELECT address, role, status FROM team_members WHERE safe_address=$1 ORDER BY invited_at",
      [safe],
    ),
    pool!.query(
      `(SELECT * FROM team_proposals WHERE safe_address=$1 AND status='pending' ORDER BY nonce NULLS LAST, created_at)
       UNION ALL
       (SELECT * FROM team_proposals WHERE safe_address=$1 AND status<>'pending' ORDER BY closed_at DESC NULLS LAST LIMIT 30)`,
      [safe],
    ),
  ]);
  const ids = proposals.rows.map((row) => row.id);
  const votes = ids.length
    ? await pool!.query(
        "SELECT proposal_id, signer, signature, rejected FROM team_signatures WHERE proposal_id = ANY($1::bigint[])",
        [ids],
      )
    : { rows: [] as any[] };
  const placed = proposals.rows.filter((row) => row.status === "pending" && row.nonce !== null);
  const lastPlaced = placed.length ? String(placed[placed.length - 1].nonce) : null;
  return {
    team: {
      safe,
      name: team.rows[0]?.name || "",
      chainId: env.rhcChainId,
      createdBy: getAddress(team.rows[0].created_by),
    },
    you,
    owners: state.owners,
    threshold: state.threshold,
    nonce: state.nonce.toString(),
    nextNonce: nextNonce.toString(),
    // The team's approval rule: a fixed number, or null for more than half.
    rule,
    members: members.rows.map((row) => ({
      address: getAddress(row.address),
      role: row.role,
      status: row.status,
      signer: state.owners.includes(getAddress(row.address)),
    })),
    proposals: proposals.rows.map((row) => {
      const mine = votes.rows.filter((vote) => String(vote.proposal_id) === String(row.id));
      const approvals = mine
        .filter((vote) => !vote.rejected && vote.signature)
        .map((vote) => ({ signer: getAddress(vote.signer), signature: vote.signature }));
      const rejections = mine
        .filter((vote) => vote.rejected)
        .map((vote) => ({ signer: getAddress(vote.signer), signature: vote.signature || null }));
      const counting = (list: { signer: Address }[]) =>
        list.filter((vote) => state.owners.includes(vote.signer)).length;
      // What the next approval would sign, for a proposal with no place yet.
      const preview =
        row.status === "pending" && row.nonce === null
          ? fieldsAt(row, ownersAtEnd, ruleAtEnd, safe)
          : null;
      return {
        id: String(row.id),
        kind: row.kind,
        subject: row.subject ? getAddress(row.subject) : null,
        rule: row.kind === "threshold" ? (row.rule ? Number(row.rule) : null) : undefined,
        to: getAddress(row.to_address),
        value: String(row.value),
        data: row.data ?? preview?.data ?? null,
        nonce: row.nonce === null ? null : String(row.nonce),
        safeTxHash: row.safe_tx_hash,
        note: row.note,
        createdBy: getAddress(row.created_by),
        createdAt: new Date(row.created_at).toISOString(),
        status: row.status,
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        expired:
          row.status === "expired" ||
          Boolean(row.expires_at && new Date(row.expires_at).getTime() <= Date.now()),
        remainingSeconds:
          row.expires_at && row.status === "pending"
            ? Math.max(0, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000))
            : null,
        cancelRequested: row.cancel_requested,
        rebuiltAt: row.rebuilt_at ? new Date(row.rebuilt_at).toISOString() : null,
        executedTxHash: row.executed_tx_hash,
        last: row.nonce !== null && String(row.nonce) === lastPlaced,
        approvals,
        rejections,
        // Can no longer reach the threshold from the signers who have not said no.
        blocked: counting(rejections) > state.owners.length - state.threshold,
        // Enough signers signed the empty transaction to cancel it on-chain.
        cancellable: row.nonce !== null && counting(rejections) >= state.threshold,
      };
    }),
  };
}

// --- Writing: the team ---------------------------------------------------------

/** Bring a Safe into Tera. The wallet that signs must be one of its owners. */
export async function registerTeam(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const safe = address(body.team, "The treasury");
  const name = cleanText(body.name, MAX_TEAM_NAME);
  const wallet = await signed("register", safe, body, [["Name", name]]);
  await assertSafe(safe);
  const state = await onChain(safe);
  must(state.owners.includes(wallet), "Only one of this Safe's signers can bring it into Tera.");
  return transaction(async (db) => {
    const exists = await db.query("SELECT 1 FROM teams WHERE safe_address=$1", [safe]);
    must(!exists.rowCount, "This treasury is already a Tera team. Ask its admin to invite you.");
    // An imported Safe keeps the rule it already has, unless that is a majority.
    const rule = state.threshold === majority(state.owners.length) ? null : state.threshold;
    await db.query(
      "INSERT INTO teams(safe_address, chain_id, name, created_by, approval_rule) VALUES($1,$2,$3,$4,$5)",
      [safe, env.rhcChainId, name, wallet, rule],
    );
    await db.query(
      "INSERT INTO team_members(safe_address, address, role, status, invited_by, joined_at) VALUES($1,$2,'admin','active',$2,NOW())",
      [safe, wallet],
    );
    // The Safe's other signers already sign; they are listed as approvers and
    // asked to accept, so they see the team without choosing to join it.
    for (const owner of state.owners.filter((owner) => owner !== wallet))
      await db.query(
        "INSERT INTO team_members(safe_address, address, role, status, invited_by) VALUES($1,$2,'approver','invited',$3)",
        [safe, owner, wallet],
      );
    return { safe, name, admin: wallet, owners: state.owners, threshold: state.threshold };
  });
}

export async function invite(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const safe = await requireTeam(body.team);
  const role = String(body.role) as Role;
  must(ROLES.includes(role), "Choose a role.");
  const wallet = await signed("invite", safe, body, [
    ["Member", memberField(body.member)],
    ["Role", role],
  ]);
  await requireAbility(safe, wallet, "manage");
  const who = await resolveMember(body.member);
  return transaction(async (db) => {
    await lockTeam(db, safe);
    const existing = await db.query(
      "SELECT status FROM team_members WHERE safe_address=$1 AND address=$2",
      [safe, who],
    );
    must(existing.rows[0]?.status !== "active", "That wallet is already on the team.");
    await db.query(
      `INSERT INTO team_members(safe_address, address, role, status, invited_by, invited_at) VALUES($1,$2,$3,'invited',$4,NOW())
       ON CONFLICT (safe_address, address) DO UPDATE SET role=EXCLUDED.role, invited_by=EXCLUDED.invited_by, invited_at=NOW()`,
      [safe, who, role, wallet],
    );
    return { safe, member: who, role, status: "invited" };
  });
}

export async function respond(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const safe = await requireTeam(body.team);
  const accept = body.accept === true;
  const wallet = await signed(accept ? "accept" : "decline", safe, body);
  return transaction(async (db) => {
    await lockTeam(db, safe);
    const found = await db.query(
      "SELECT role, status, invited_by FROM team_members WHERE safe_address=$1 AND address=$2",
      [safe, wallet],
    );
    const row = found.rows[0];
    must(row && row.status === "invited", "There is no invitation for this wallet.");
    if (!accept) {
      await db.query("DELETE FROM team_members WHERE safe_address=$1 AND address=$2", [
        safe,
        wallet,
      ]);
      return { safe, declined: true };
    }
    await db.query(
      "UPDATE team_members SET status='active', joined_at=NOW() WHERE safe_address=$1 AND address=$2",
      [safe, wallet],
    );
    // A signer role is only real once the Safe says so: queue the change for
    // the current signers to approve.
    const queued = isSignerRole(row.role)
      ? await queueChange(
          db,
          safe,
          { kind: "add-signer", subject: wallet },
          getAddress(row.invited_by || wallet),
        )
      : null;
    return { safe, role: row.role, status: "active", signerProposal: queued };
  });
}

async function adminCount(db: Db, safe: Address) {
  const found = await db.query(
    "SELECT COUNT(*)::int AS n FROM team_members WHERE safe_address=$1 AND role='admin' AND status='active'",
    [safe],
  );
  return Number(found.rows[0].n);
}

export async function changeRole(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const safe = await requireTeam(body.team);
  const who = address(body.member, "The member");
  const role = String(body.role) as Role;
  must(ROLES.includes(role), "Choose a role.");
  const wallet = await signed("role", safe, body, [
    ["Member", who.toLowerCase()],
    ["Role", role],
  ]);
  await requireAbility(safe, wallet, "manage");
  return transaction(async (db) => {
    await lockTeam(db, safe);
    const current = await memberOf(safe, who);
    must(current, "That wallet is not on the team.");
    if (current!.role === "admin" && role !== "admin")
      must((await adminCount(db, safe)) > 1, "A team needs at least one admin.");
    await db.query("UPDATE team_members SET role=$3 WHERE safe_address=$1 AND address=$2", [
      safe,
      who,
      role,
    ]);
    // An invited member's signer change waits for them to accept.
    const queued =
      current!.status === "active" && isSignerRole(role) !== isSignerRole(current!.role)
        ? await steerSigner(
            db,
            safe,
            who,
            isSignerRole(role) ? "add-signer" : "remove-signer",
            wallet,
          )
        : null;
    return { safe, member: who, role, signerProposal: queued };
  });
}

export async function removeMember(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const safe = await requireTeam(body.team);
  const who = address(body.member, "The member");
  const wallet = await signed("remove", safe, body, [["Member", who.toLowerCase()]]);
  // An admin removes anyone; anyone can leave.
  if (wallet !== who) await requireAbility(safe, wallet, "manage");
  return transaction(async (db) => {
    await lockTeam(db, safe);
    const current = await memberOf(safe, who);
    must(current, "That wallet is not on the team.");
    if (current!.role === "admin" && current!.status === "active")
      must((await adminCount(db, safe)) > 1, "A team needs at least one admin.");
    const { state } = await reconcile(db, safe);
    must(
      !state.owners.includes(who) || state.owners.length > 1,
      "A treasury needs at least one signer. Add another first.",
    );
    const queued = await steerSigner(db, safe, who, "remove-signer", wallet);
    await db.query("DELETE FROM team_members WHERE safe_address=$1 AND address=$2", [safe, who]);
    return { safe, member: who, removed: true, signerProposal: queued };
  });
}

/**
 * Propose a new approval rule: a fixed number of approvals, or "majority".
 * It is itself a treasury change, so the current signers approve it under the
 * current rule. One pending rule change at a time; a new one replaces it.
 */
export async function setRule(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const safe = await requireTeam(body.team);
  const majorityRule = body.rule === "majority";
  const fixed = Number(body.rule);
  must(
    majorityRule || (Number.isInteger(fixed) && fixed >= 1 && fixed <= 50),
    "Choose how many approvals.",
  );
  const rule = majorityRule ? null : fixed;
  const wallet = await signed("rule", safe, body, [["Approvals", rule ?? "majority"]]);
  await requireAbility(safe, wallet, "manage");
  return transaction(async (db) => {
    await lockTeam(db, safe);
    const pending = await db.query(
      "SELECT id, nonce FROM team_proposals WHERE safe_address=$1 AND status='pending' AND kind='threshold'",
      [safe],
    );
    for (const row of pending.rows) {
      await db.query("UPDATE team_proposals SET status='cancelled', closed_at=NOW() WHERE id=$1", [
        row.id,
      ]);
      if (row.nonce !== null) await closeGap(db, safe, BigInt(row.nonce));
    }
    const { ownersAtEnd, ruleAtEnd } = await reconcile(db, safe);
    must(
      rule === null || rule <= ownersAtEnd.length,
      `The treasury has ${ownersAtEnd.length} signer${ownersAtEnd.length === 1 ? "" : "s"}; it cannot need more approvals than that.`,
    );
    must(
      rule !== ruleAtEnd ||
        thresholdFor(ownersAtEnd.length, rule) !== thresholdFor(ownersAtEnd.length, ruleAtEnd),
      "That is already the rule.",
    );
    const inserted = await db.query(
      `INSERT INTO team_proposals(safe_address, kind, rule, to_address, value, note, created_by)
       VALUES($1,'threshold',$2,$1,0,$3,$4) RETURNING id`,
      [
        safe,
        rule ?? 0,
        rule === null ? "Require more than half of the signers" : `Require ${rule} approvals`,
        wallet,
      ],
    );
    return { id: String(inserted.rows[0].id), rule };
  });
}

// --- Writing: payments ---------------------------------------------------------

/** A payment for the signers to approve: native value, or one ERC-20 transfer. */
export async function propose(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const safe = await requireTeam(body.team);
  const to = address(body.to, "A destination");
  const data = String(body.data ?? "0x").toLowerCase() as Hex;
  must(/^0x([\da-f]{2})*$/.test(data), "The transaction data is malformed.");
  let value: bigint;
  try {
    value = BigInt(String(body.value ?? "0"));
  } catch {
    throw new TeamServiceError("The amount is malformed.");
  }
  must(value >= 0n, "The amount is malformed.");
  // Only what a payment looks like. Signer changes come from the member
  // routes, and nothing here can make the Safe call itself or delegatecall.
  const nativePayment = data === "0x" && value > 0n;
  const tokenPayment = value === 0n && data.startsWith("0xa9059cbb") && data.length === 138;
  must(nativePayment || tokenPayment, "A team proposal is a single payment.");
  must(to !== safe, "A payment cannot be sent to the treasury itself.");
  const note = cleanText(body.note, MAX_NOTE);
  const expirationSeconds = parseExpirationSeconds(body.expirationSeconds ?? body.expiresIn);
  const fields: [string, unknown][] = [
    ["To", to.toLowerCase()],
    ["Value", value.toString()],
    ["Data", data],
    ["Note", note],
  ];
  if (expirationSeconds !== null) {
    fields.push(["ExpiresIn", `${expirationSeconds}s`]);
  }
  const wallet = await signed("propose", safe, body, fields);
  await requireAbility(safe, wallet, "propose");
  const expiresAt =
    expirationSeconds !== null
      ? new Date(Date.now() + expirationSeconds * 1000).toISOString()
      : null;
  // No place in the queue yet: that comes with the first approval.
  const inserted = await pool!.query(
    `INSERT INTO team_proposals(safe_address, kind, to_address, value, data, note, created_by, expires_at)
     VALUES($1,'payment',$2,$3,$4,$5,$6,$7) RETURNING id`,
    [safe, to, value.toString(), data, note, wallet, expiresAt],
  );
  return { id: String(inserted.rows[0].id), expiresAt };
}

async function proposalRow(input: unknown) {
  must(/^\d{1,18}$/.test(String(input ?? "")), "Unknown proposal.");
  const found = await pool!.query("SELECT * FROM team_proposals WHERE id=$1", [String(input)]);
  must(found.rowCount, "Unknown proposal.", 404);
  return found.rows[0];
}

/**
 * Record a signer's approval: the Safe's own EIP-712 message over the
 * proposal's fields at its nonce, recovered here and checked against the
 * Safe's owner list — exactly what the contract will accept later.
 *
 * A proposal without a place takes the next free nonce with this approval.
 * The approver signed for the nonce they were shown; if the queue moved in
 * between, this answers 409 and the app signs again for the new one.
 */
export async function approve(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const first = await proposalRow(body.id);
  const safe = getAddress(first.safe_address);
  const wallet = address(body.wallet);
  await requireAbility(safe, wallet, "approve");
  return transaction(async (db) => {
    await lockTeam(db, safe);
    const { state, ownersAtEnd, ruleAtEnd, nextNonce } = await reconcile(db, safe);
    const found = await db.query("SELECT * FROM team_proposals WHERE id=$1", [first.id]);
    const row = found.rows[0];
    must(row.status === "pending", "This proposal is no longer waiting for approvals.");
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      await db.query("UPDATE team_proposals SET status='expired', closed_at=NOW() WHERE id=$1", [
        row.id,
      ]);
      if (row.nonce !== null && row.nonce !== undefined) {
        await closeGap(db, safe, BigInt(row.nonce));
      }
      throw new TeamServiceError("This proposal has expired.");
    }
    must(
      state.owners.includes(wallet),
      "Only the treasury's signers can approve. Yours is still waiting to be added.",
    );
    let nonce: bigint;
    let fields: { to: Address; value: bigint; data: Hex };
    if (row.nonce === null) {
      must(
        String(body.nonce ?? "") === nextNonce.toString(),
        "The queue moved while you were approving. Approve again.",
        409,
      );
      const at = fieldsAt(row, ownersAtEnd, ruleAtEnd, safe);
      must(at, "This signer change no longer makes sense for the treasury as it stands.");
      nonce = nextNonce;
      fields = at!;
    } else {
      nonce = BigInt(row.nonce);
      must(
        body.nonce === undefined || String(body.nonce) === nonce.toString(),
        "The queue moved while you were approving. Approve again.",
        409,
      );
      fields = { to: getAddress(row.to_address), value: BigInt(row.value), data: row.data };
    }
    const signer = await recoverSafeTx(safe, { ...fields, nonce }, body.signature);
    must(signer === wallet, "That approval was not signed by this wallet for this proposal.");
    if (row.nonce === null) {
      const hash = await hashFor(safe, fields.to, fields.value, fields.data, nonce);
      await db.query("UPDATE team_proposals SET nonce=$2, data=$3, safe_tx_hash=$4 WHERE id=$1", [
        row.id,
        nonce.toString(),
        fields.data,
        hash,
      ]);
    }
    await db.query(
      `INSERT INTO team_signatures(proposal_id, signer, signature, rejected) VALUES($1,$2,$3,FALSE)
       ON CONFLICT (proposal_id, signer) DO UPDATE SET signature=EXCLUDED.signature, rejected=FALSE, created_at=NOW()`,
      [row.id, wallet, body.signature],
    );
    return { id: String(row.id), approvedBy: wallet, nonce: nonce.toString() };
  });
}

/**
 * A signer says no. For a placed proposal the signature is over the Safe's
 * empty transaction at the same nonce — enough of them and anyone can send it,
 * using the nonce up and leaving the rest of the queue as it was. For one with
 * no place, it is a signed vote, and the proposal closes once it cannot pass.
 */
export async function reject(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const first = await proposalRow(body.id);
  const safe = getAddress(first.safe_address);
  const wallet = address(body.wallet);
  return transaction(async (db) => {
    await lockTeam(db, safe);
    const { state } = await reconcile(db, safe);
    const found = await db.query("SELECT * FROM team_proposals WHERE id=$1", [first.id]);
    const row = found.rows[0];
    must(row.status === "pending", "This proposal is no longer waiting for approvals.");
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      await db.query("UPDATE team_proposals SET status='expired', closed_at=NOW() WHERE id=$1", [
        row.id,
      ]);
      if (row.nonce !== null && row.nonce !== undefined) {
        await closeGap(db, safe, BigInt(row.nonce));
      }
      throw new TeamServiceError("This proposal has expired.");
    }
    await requireAbility(safe, wallet, "approve");
    must(state.owners.includes(wallet), "Only the treasury's signers can reject.");
    let signature: string | null = null;
    if (row.nonce === null) {
      await signed("reject", safe, body, [["Proposal", String(row.id)]]);
    } else {
      const signer = await recoverSafeTx(
        safe,
        { to: safe, value: 0n, data: "0x", nonce: BigInt(row.nonce) },
        body.signature,
      );
      must(signer === wallet, "That rejection was not signed by this wallet for this proposal.");
      signature = String(body.signature);
    }
    await db.query(
      `INSERT INTO team_signatures(proposal_id, signer, signature, rejected) VALUES($1,$2,$3,TRUE)
       ON CONFLICT (proposal_id, signer) DO UPDATE SET signature=EXCLUDED.signature, rejected=TRUE, created_at=NOW()`,
      [row.id, wallet, signature],
    );
    if (
      row.nonce === null &&
      (await rejectionsFrom(db, row.id, state.owners)) > state.owners.length - state.threshold
    ) {
      await db.query("UPDATE team_proposals SET status='rejected', closed_at=NOW() WHERE id=$1", [
        row.id,
      ]);
      return { id: String(row.id), status: "rejected" };
    }
    return { id: String(row.id), status: "pending", rejectedBy: wallet };
  });
}

/**
 * The member who proposed it, or an admin, withdraws it. With no place, or as
 * the last placed proposal, it just closes. In the middle of the queue the
 * choice is theirs: "now" closes the gap (later approvals must be collected
 * again), "onchain" asks the signers to sign its cancellation instead.
 */
export async function cancel(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const first = await proposalRow(body.id);
  const safe = getAddress(first.safe_address);
  const mode = body.mode === "onchain" ? "onchain" : "now";
  const wallet = await signed("cancel", safe, body, [
    ["Proposal", String(first.id)],
    ["Mode", mode],
  ]);
  const member = await requireAbility(safe, wallet, "view");
  must(
    getAddress(first.created_by) === wallet || can(member.role, "manage"),
    "Only whoever proposed this, or an admin, can cancel it.",
    403,
  );
  return transaction(async (db) => {
    await lockTeam(db, safe);
    await reconcile(db, safe);
    const found = await db.query("SELECT * FROM team_proposals WHERE id=$1", [first.id]);
    const row = found.rows[0];
    must(row.status === "pending", "This proposal is no longer waiting for approvals.");
    const later =
      row.nonce === null
        ? 0
        : Number(
            (
              await db.query(
                "SELECT COUNT(*)::int AS n FROM team_proposals WHERE safe_address=$1 AND status='pending' AND nonce > $2",
                [safe, String(row.nonce)],
              )
            ).rows[0].n,
          );
    if (mode === "onchain" && later > 0) {
      await db.query("UPDATE team_proposals SET cancel_requested=TRUE WHERE id=$1", [row.id]);
      return { id: String(row.id), status: "pending", cancelRequested: true };
    }
    await db.query("UPDATE team_proposals SET status='cancelled', closed_at=NOW() WHERE id=$1", [
      row.id,
    ]);
    if (row.nonce !== null && later > 0) await closeGap(db, safe, BigInt(row.nonce));
    return { id: String(row.id), status: "cancelled", reordered: later };
  });
}

/**
 * Mark a proposal done once the chain shows it: the proposal itself, or with
 * `rejection`, its cancellation. Needs no signature: the receipt is the proof.
 */
export async function executed(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const row = await proposalRow(body.id);
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw new TeamServiceError("This proposal has expired.");
  }
  const hash = String(body.txHash ?? "");
  must(/^0x[\da-fA-F]{64}$/.test(hash), "A transaction hash is required.");
  must(row.nonce !== null, "This proposal has no place in the queue yet.");
  const safe = getAddress(row.safe_address);
  const receipt = await client.getTransactionReceipt({ hash: hash as Hex }).catch(() => null);
  must(receipt, "That transaction is not on chain yet.");
  must(receipt!.status === "success", "That transaction failed on chain.");
  must(
    receipt!.to && getAddress(receipt!.to) === safe,
    "That transaction was not sent to this treasury.",
  );
  const state = await onChain(safe);
  must(state.nonce > BigInt(row.nonce), "The treasury has not used this proposal's place yet.");
  const status = body.rejection === true ? "rejected" : "executed";
  if (status === "executed" && row.kind === "threshold")
    await adoptRule(pool! as unknown as Db, safe, row.rule);
  await pool!.query(
    "UPDATE team_proposals SET status=$3, executed_tx_hash=$2, closed_at=COALESCE(closed_at, NOW()) WHERE id=$1",
    [row.id, hash.toLowerCase(), status],
  );
  return { id: String(row.id), status, txHash: hash.toLowerCase() };
}
