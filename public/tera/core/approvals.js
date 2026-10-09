// Token approvals: what this wallet has let other contracts spend, and the
// transaction that takes it back. No network access of its own.
//
// An approval outlives the swap or bridge that asked for it. A router given
// "unlimited" USDG once can move every USDG the wallet ever holds, for as long
// as the approval stands, and nothing on the home screen says so. This finds
// them and writes the revoke.
//
// The rules, each one a test:
//
//   The chain is the record. Approvals are found from the wallet's own Approval
//   and ApprovalForAll events, and only the newest event for each token and
//   spender counts — a later approval replaces an earlier one.
//
//   An event says what was approved, not what is left. The amount shown is the
//   allowance read live, so a grant that has been spent down or already revoked
//   is not listed as open.
//
//   A revoke is exactly approve(spender, 0) on that token, or
//   setApprovalForAll(operator, false) on that collection — checked here on the
//   device before the review and again at signing.

/** keccak256("Approval(address,address,uint256)") */
export const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
/** keccak256("ApprovalForAll(address,address,bool)") */
export const APPROVAL_FOR_ALL_TOPIC = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";
/** The widest block range the network's log search accepts in one request. */
export const LOG_SPAN = 10_000_000n;
/**
 * From here up an allowance is shown as unlimited. 2^128 base units is more
 * than any real token supply, so a grant this large is "everything", whatever
 * exact number the app that asked for it chose.
 */
export const UNLIMITED_FROM = 2n ** 128n;

const APPROVE = "0x095ea7b3";
const SET_APPROVAL_FOR_ALL = "0xa22cb465";
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const lower = (value) => String(value ?? "").toLowerCase();
const word = (hex) => hex.slice(2).toLowerCase().padStart(64, "0");
const topicAddress = (topic) => `0x${String(topic).slice(-40)}`.toLowerCase();

/** The topic that filters logs to those naming this owner as the approver. */
export function ownerTopic(owner) {
  if (!ADDRESS.test(owner)) throw new Error("Invalid owner address.");
  return `0x${word(owner)}`;
}

/** Block ranges covering 0..head, each within the network's log search limit. */
export function scanRanges(head, span = LOG_SPAN) {
  const last = BigInt(head);
  const ranges = [];
  for (let from = 0n; from <= last; from += span) {
    const to = from + span - 1n < last ? from + span - 1n : last;
    ranges.push({ fromBlock: from, toBlock: to });
  }
  return ranges;
}

/**
 * The newest approval per token and spender, from raw logs. ERC-721's
 * per-item Approval shares the ERC-20 topic but indexes the token id as a
 * fourth topic; those are left out — they are cleared when the item moves.
 */
export function latestGrants(logs, owner) {
  const me = lower(owner);
  const newest = new Map();
  for (const log of logs || []) {
    // The block explorer pads topics to four with nulls; the node does not.
    const topics = (log?.topics || []).filter((topic) => topic != null);
    if (topics.length !== 3 || topicAddress(topics[1]) !== me) continue;
    const data = String(log.data || "0x");
    let grant;
    if (lower(topics[0]) === APPROVAL_TOPIC && data.length === 66) {
      grant = { kind: "token", amount: BigInt(data) };
    } else if (lower(topics[0]) === APPROVAL_FOR_ALL_TOPIC && data.length === 66) {
      grant = { kind: "collection", approved: BigInt(data) !== 0n };
    } else continue;
    grant.token = lower(log.address);
    grant.spender = topicAddress(topics[2]);
    grant.block = BigInt(log.blockNumber ?? 0);
    grant.logIndex = Number(BigInt(log.logIndex ?? 0));
    const key = `${grant.kind}:${grant.token}:${grant.spender}`;
    const seen = newest.get(key);
    if (!seen || grant.block > seen.block || (grant.block === seen.block && grant.logIndex > seen.logIndex))
      newest.set(key, grant);
  }
  return [...newest.values()];
}

export const isUnlimited = (amount) => BigInt(amount) >= UNLIMITED_FROM;

/**
 * Grants still open once the live allowance is known: a token with an
 * allowance above zero, a collection still approved. Unlimited first, then
 * most recent.
 */
export function openGrants(grants) {
  return grants
    .filter((g) => (g.kind === "token" ? BigInt(g.amount) > 0n : g.approved === true))
    .sort((a, b) => {
      const rank = (g) => (g.kind === "collection" || isUnlimited(g.amount) ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return a.block === b.block ? 0 : a.block > b.block ? -1 : 1;
    });
}

/** The revoke for one grant, as an unsigned call. */
export function revokeCall(grant) {
  if (!ADDRESS.test(grant?.token) || !ADDRESS.test(grant?.spender)) throw new Error("Invalid approval.");
  const data =
    grant.kind === "collection"
      ? `${SET_APPROVAL_FOR_ALL}${word(grant.spender)}${"0".repeat(64)}`
      : `${APPROVE}${word(grant.spender)}${"0".repeat(64)}`;
  return { to: lower(grant.token), data, value: "0" };
}

/** Throws unless tx is exactly the revoke for this grant. */
export function checkRevoke(tx, grant) {
  const expected = revokeCall(grant);
  if (lower(tx?.to) !== expected.to || lower(tx?.data) !== expected.data || BigInt(tx?.value ?? -1) !== 0n)
    throw new Error("Transaction does not match your review. / 交易与审核内容不符。");
}

/** A name for a spender Tera itself uses, or null for anyone else. */
export function spenderName(spender, known) {
  const hit = Object.entries(known || {}).find(([address]) => lower(address) === lower(spender));
  return hit ? hit[1] : null;
}
