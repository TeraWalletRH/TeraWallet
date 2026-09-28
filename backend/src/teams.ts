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
//   it is queued; "executed" is taken from a receipt or the Safe's nonce.
//
//   Every write is signed by the member making it, over text rebuilt here from
//   what is about to happen (core/teams.js), and a read is signed too, because
//   a team's queue says who it pays and why.

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
  type Role,
} from "./teams-core";

const SIGNATURE_WINDOW_MS = 5 * 60_000;
const SENTINEL = "0x0000000000000000000000000000000000000001";

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
    authority:
      "The treasury is a Safe: only its signers' approvals can move money, checked by the contract. Tera keeps the member list and the approval queue, and cannot execute anything.",
  };
}

// --- The chain ------------------------------------------------------------------

const client = createPublicClient({ transport: http(env.rhcRpcUrl, { timeout: 20_000 }) });

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function addOwnerWithThreshold(address owner, uint256 _threshold)",
  "function removeOwner(address prevOwner, address owner, uint256 _threshold)",
]);

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

/** Put a transaction at the end of the queue: the next nonce after everything pending. */
async function enqueue(
  db: Db,
  safe: Address,
  entry: { kind: string; to: Address; value: bigint; data: Hex; note: string; createdBy: Address },
) {
  const state = await onChain(safe);
  const pending = await db.query(
    "SELECT MAX(nonce) AS top FROM team_proposals WHERE safe_address=$1 AND status='pending'",
    [safe],
  );
  const top = pending.rows[0]?.top;
  const nonce =
    top !== null && top !== undefined && BigInt(top) + 1n > state.nonce
      ? BigInt(top) + 1n
      : state.nonce;
  const hash = await hashFor(safe, entry.to, entry.value, entry.data, nonce);
  const inserted = await db.query(
    `INSERT INTO team_proposals(safe_address, kind, to_address, value, data, nonce, safe_tx_hash, note, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      safe,
      entry.kind,
      entry.to,
      entry.value.toString(),
      entry.data,
      nonce.toString(),
      hash,
      entry.note,
      entry.createdBy,
    ],
  );
  return { id: String(inserted.rows[0].id), nonce: nonce.toString(), safeTxHash: hash };
}

/**
 * Close a gap in the queue. A Safe executes nonces strictly in order, so when
 * a proposal is cancelled or rejected every later one moves down by one — and
 * its approvals are cleared, because they were signatures over the old nonce.
 */
async function closeGap(db: Db, safe: Address, removed: bigint) {
  const later = await db.query(
    "SELECT id, to_address, value, data, nonce FROM team_proposals WHERE safe_address=$1 AND status='pending' AND nonce > $2 ORDER BY nonce",
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

/** Signer changes queued but not yet executed, in queue order. */
async function pendingSignerChanges(db: Db, safe: Address) {
  const rows = await db.query(
    "SELECT kind, data FROM team_proposals WHERE safe_address=$1 AND status='pending' AND kind IN ('add-signer','remove-signer')",
    [safe],
  );
  return rows.rows as { kind: string; data: string }[];
}

async function queueAddSigner(db: Db, safe: Address, who: Address, by: Address) {
  const state = await onChain(safe);
  if (state.owners.includes(who)) return null;
  const changes = await pendingSignerChanges(db, safe);
  const whoData = who.toLowerCase().slice(2);
  if (changes.some((c) => c.kind === "add-signer" && c.data.toLowerCase().includes(whoData)))
    return null;
  const after =
    state.owners.length +
    changes.filter((c) => c.kind === "add-signer").length -
    changes.filter((c) => c.kind === "remove-signer").length +
    1;
  return enqueue(db, safe, {
    kind: "add-signer",
    to: safe,
    value: 0n,
    data: encodeFunctionData({
      abi: safeAbi,
      functionName: "addOwnerWithThreshold",
      args: [who, BigInt(majority(after))],
    }),
    note: `Add ${who} as a signer`,
    createdBy: by,
  });
}

async function queueRemoveSigner(db: Db, safe: Address, who: Address, by: Address) {
  const state = await onChain(safe);
  const index = state.owners.indexOf(who);
  if (index < 0) return null;
  const changes = await pendingSignerChanges(db, safe);
  const whoData = who.toLowerCase().slice(2);
  if (changes.some((c) => c.kind === "remove-signer" && c.data.toLowerCase().includes(whoData)))
    return null;
  const after =
    state.owners.length +
    changes.filter((c) => c.kind === "add-signer").length -
    changes.filter((c) => c.kind === "remove-signer").length -
    1;
  must(after >= 1, "A treasury needs at least one signer. Add another before removing this one.");
  return enqueue(db, safe, {
    kind: "remove-signer",
    to: safe,
    value: 0n,
    data: encodeFunctionData({
      abi: safeAbi,
      functionName: "removeOwner",
      // The owner before this one in the Safe's list, as it stands now. If the
      // list changes before this executes, the Safe refuses it rather than
      // removing someone else.
      args: [
        (index === 0 ? SENTINEL : state.owners[index - 1]) as Address,
        who,
        BigInt(majority(after)),
      ],
    }),
    note: `Remove ${who} as a signer`,
    createdBy: by,
  });
}

/** Proposals the Safe has moved past are done, whoever submitted them. */
async function settle(safe: Address, nonce: bigint) {
  await pool!.query(
    "UPDATE team_proposals SET status='executed', closed_at=NOW() WHERE safe_address=$1 AND status='pending' AND nonce < $2",
    [safe, nonce.toString()],
  );
}

async function transaction<T>(work: (db: Db) => Promise<T>) {
  const db = await pool!.connect();
  try {
    await db.query("BEGIN");
    // One writer per team at a time: nonces are handed out in order.
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

async function lockTeam(db: Db, safe: Address) {
  await db.query("SELECT safe_address FROM teams WHERE safe_address=$1 FOR UPDATE", [safe]);
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
  const state = await onChain(safe);
  await settle(safe, state.nonce);
  const [team, members, proposals] = await Promise.all([
    pool!.query("SELECT name, created_by, created_at FROM teams WHERE safe_address=$1", [safe]),
    pool!.query(
      "SELECT address, role, status, invited_at, joined_at FROM team_members WHERE safe_address=$1 ORDER BY invited_at",
      [safe],
    ),
    pool!.query(
      `(SELECT * FROM team_proposals WHERE safe_address=$1 AND status='pending' ORDER BY nonce)
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
    members: members.rows.map((row) => ({
      address: getAddress(row.address),
      role: row.role,
      status: row.status,
      signer: state.owners.includes(getAddress(row.address)),
    })),
    proposals: proposals.rows.map((row) => {
      const mine = votes.rows.filter((vote) => String(vote.proposal_id) === String(row.id));
      return {
        id: String(row.id),
        kind: row.kind,
        to: getAddress(row.to_address),
        value: String(row.value),
        data: row.data,
        nonce: String(row.nonce),
        safeTxHash: row.safe_tx_hash,
        note: row.note,
        createdBy: getAddress(row.created_by),
        createdAt: new Date(row.created_at).toISOString(),
        status: row.status,
        executedTxHash: row.executed_tx_hash,
        // Only signatures from current owners count toward the threshold.
        approvals: mine
          .filter((vote) => !vote.rejected && vote.signature)
          .map((vote) => ({ signer: getAddress(vote.signer), signature: vote.signature })),
        rejections: mine.filter((vote) => vote.rejected).map((vote) => getAddress(vote.signer)),
      };
    }),
  };
}

// --- Writing -------------------------------------------------------------------

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
    await db.query(
      "INSERT INTO teams(safe_address, chain_id, name, created_by) VALUES($1,$2,$3,$4)",
      [safe, env.rhcChainId, name, wallet],
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
      ? await queueAddSigner(db, safe, wallet, getAddress(row.invited_by || wallet))
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
    let queued = null;
    if (current!.status === "active" && isSignerRole(role) && !isSignerRole(current!.role))
      queued = await queueAddSigner(db, safe, who, wallet);
    if (!isSignerRole(role) && isSignerRole(current!.role))
      queued = await queueRemoveSigner(db, safe, who, wallet);
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
    const queued = await queueRemoveSigner(db, safe, who, wallet);
    await db.query("DELETE FROM team_members WHERE safe_address=$1 AND address=$2", [safe, who]);
    return { safe, member: who, removed: true, signerProposal: queued };
  });
}

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
  const wallet = await signed("propose", safe, body, [
    ["To", to.toLowerCase()],
    ["Value", value.toString()],
    ["Data", data],
    ["Note", note],
  ]);
  await requireAbility(safe, wallet, "propose");
  return transaction(async (db) => {
    await lockTeam(db, safe);
    return enqueue(db, safe, { kind: "payment", to, value, data, note, createdBy: wallet });
  });
}

async function proposalRow(input: unknown) {
  must(/^\d{1,18}$/.test(String(input ?? "")), "Unknown proposal.");
  const found = await pool!.query("SELECT * FROM team_proposals WHERE id=$1", [String(input)]);
  must(found.rowCount, "Unknown proposal.", 404);
  return found.rows[0];
}

/**
 * Record a signer's approval. The signature is the Safe's own EIP-712 message
 * over the proposal's fields, recovered here and checked against the Safe's
 * owner list now — so it is exactly what the contract will accept later.
 */
export async function approve(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const row = await proposalRow(body.id);
  must(row.status === "pending", "This proposal is no longer waiting for approvals.");
  const safe = getAddress(row.safe_address);
  const wallet = address(body.wallet);
  must(
    typeof body.signature === "string" && /^0x[\da-fA-F]{130}$/.test(body.signature),
    "A signature is required.",
  );
  let signer: Address | null = null;
  try {
    const typed = safeTxTypedData({
      safe,
      chainId: env.rhcChainId,
      to: getAddress(row.to_address),
      value: BigInt(row.value),
      data: row.data,
      nonce: BigInt(row.nonce),
    });
    signer = await recoverTypedDataAddress({
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
      signature: body.signature as Hex,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
  } catch {
    signer = null;
  }
  must(signer === wallet, "That approval was not signed by this wallet for this payment.");
  await requireAbility(safe, wallet, "approve");
  const state = await onChain(safe);
  must(
    state.owners.includes(wallet),
    "Only the treasury's signers can approve. Yours is still waiting to be added.",
  );
  await pool!.query(
    `INSERT INTO team_signatures(proposal_id, signer, signature, rejected) VALUES($1,$2,$3,FALSE)
     ON CONFLICT (proposal_id, signer) DO UPDATE SET signature=EXCLUDED.signature, rejected=FALSE, created_at=NOW()`,
    [row.id, wallet, body.signature],
  );
  return { id: String(row.id), approvedBy: wallet };
}

async function close(row: { id: string; safe_address: string; nonce: string }, status: string) {
  const safe = getAddress(row.safe_address);
  return transaction(async (db) => {
    await lockTeam(db, safe);
    const updated = await db.query(
      "UPDATE team_proposals SET status=$2, closed_at=NOW() WHERE id=$1 AND status='pending'",
      [row.id, status],
    );
    must(updated.rowCount, "This proposal is no longer waiting for approvals.");
    await closeGap(db, safe, BigInt(row.nonce));
    return { id: String(row.id), status };
  });
}

/** A signer says no. Once enough have, the threshold cannot be met and it closes. */
export async function reject(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const row = await proposalRow(body.id);
  must(row.status === "pending", "This proposal is no longer waiting for approvals.");
  const safe = getAddress(row.safe_address);
  const wallet = await signed("reject", safe, body, [["Proposal", String(row.id)]]);
  await requireAbility(safe, wallet, "approve");
  const state = await onChain(safe);
  must(state.owners.includes(wallet), "Only the treasury's signers can reject.");
  await pool!.query(
    `INSERT INTO team_signatures(proposal_id, signer, signature, rejected) VALUES($1,$2,NULL,TRUE)
     ON CONFLICT (proposal_id, signer) DO UPDATE SET signature=NULL, rejected=TRUE, created_at=NOW()`,
    [row.id, wallet],
  );
  const no = await pool!.query(
    "SELECT signer FROM team_signatures WHERE proposal_id=$1 AND rejected",
    [row.id],
  );
  const rejecting = no.rows.filter((vote) => state.owners.includes(getAddress(vote.signer))).length;
  if (rejecting > state.owners.length - state.threshold) return close(row, "rejected");
  return { id: String(row.id), status: "pending", rejectedBy: wallet };
}

/** The member who proposed it, or an admin, withdraws it. */
export async function cancel(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const row = await proposalRow(body.id);
  const safe = getAddress(row.safe_address);
  const wallet = await signed("cancel", safe, body, [["Proposal", String(row.id)]]);
  const member = await requireAbility(safe, wallet, "view");
  must(
    getAddress(row.created_by) === wallet || can(member.role, "manage"),
    "Only whoever proposed this, or an admin, can cancel it.",
    403,
  );
  return close(row, "cancelled");
}

/** Mark a proposal executed once the chain shows it. Needs no signature: the receipt is the proof. */
export async function executed(body: Record<string, unknown>) {
  must(enabled(), "Teams are unavailable.", 503);
  const row = await proposalRow(body.id);
  const hash = String(body.txHash ?? "");
  must(/^0x[\da-fA-F]{64}$/.test(hash), "A transaction hash is required.");
  const safe = getAddress(row.safe_address);
  const receipt = await client.getTransactionReceipt({ hash: hash as Hex }).catch(() => null);
  must(receipt, "That transaction is not on chain yet.");
  must(receipt!.status === "success", "That transaction failed on chain.");
  must(
    receipt!.to && getAddress(receipt!.to) === safe,
    "That transaction was not sent to this treasury.",
  );
  const state = await onChain(safe);
  must(state.nonce > BigInt(row.nonce), "The treasury has not executed this proposal yet.");
  await pool!.query(
    "UPDATE team_proposals SET status='executed', executed_tx_hash=$2, closed_at=COALESCE(closed_at, NOW()) WHERE id=$1",
    [row.id, hash.toLowerCase()],
  );
  return { id: String(row.id), status: "executed", txHash: hash.toLowerCase() };
}
