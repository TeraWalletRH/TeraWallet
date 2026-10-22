// A transaction that hasn't confirmed: what really happened to it, and what
// the owner can safely do. No network access of its own; the wallet reads
// the chain and passes the answers in.
//
// Robinhood Chain runs on Arbitrum. One sequencer takes transactions first
// come, first served, and the fee buys no priority, so "speed up with a
// higher fee" means nothing here. What does happen is a transaction that
// never reached the sequencer (a dropped connection after signing), or one
// held behind a missing earlier nonce. The rules, each one a test:
//
//   Nothing is offered until a minute has passed. Almost every transaction
//   on this chain confirms in a second or two; before a minute, waiting is
//   the answer.
//
//   A receipt settles it: confirmed or reverted, no actions.
//
//   A nonce is a slot: exactly one transaction from this wallet can ever fill
//   it. "Send again" re-sends the same signed transaction, or signs the same
//   payment again in the same slot, so the original and the retry can never
//   both land. "Cancel" fills the slot with nothing (0 ETH to yourself), so
//   the original can never land afterwards.
//
//   If the slot is already filled by another transaction (the chain's count
//   of this wallet's transactions has passed it), the original can never
//   land: it says so, and offers nothing.
//
//   A transaction whose slot the wallet never recorded (made before this
//   was added) gets no actions: without the slot, a retry could pay twice.
//
//   A cancel is itself a transaction: it is checked like one, and the row
//   reads "cancelled" only once it confirms.

export const STUCK_AFTER = 60_000;

/** States, as the row and the screen name them. */
export const CONFIRMED = /** @type {"confirmed"} */ ("confirmed");
export const REVERTED = /** @type {"reverted"} */ ("reverted");
export const WAITING = /** @type {"waiting"} */ ("waiting");
export const MISSING = /** @type {"missing"} */ ("missing");
export const REPLACED = /** @type {"replaced"} */ ("replaced");
export const UNKNOWN = /** @type {"unknown"} */ ("unknown");
export const CANCELLED = /** @type {"cancelled"} */ ("cancelled");

const OPEN = ["pending", "broadcasting", "cancelling"];

/**
 * Whether a history row is old enough, and open enough, to offer help.
 *
 * A row sent again or cancelled counts from then (retriedAt), not from when it was first made.
 *
 * @param {{ hash?: string, status?: string, createdAt?: number, retriedAt?: number } | null | undefined} row
 * @param {number} [now]
 */
export function looksStuck(row, now = Date.now()) {
  if (!row?.hash || !OPEN.includes(String(row.status))) return false;
  const age = now - Number(row.retriedAt ?? row.createdAt);
  return Number.isFinite(age) && age >= STUCK_AFTER;
}

/**
 * What happened to a transaction, from what the chain says about it.
 *
 * receipt: "success" | "reverted" | null (none yet)
 * known: the node has the transaction (by hash) without a receipt
 * nonce: the slot the wallet signed it into, or null when it wasn't recorded
 * used: how many transactions from this wallet the chain has confirmed
 *       (the next free slot), or null when it couldn't be read
 *
 * @param {{ receipt: "success" | "reverted" | null, known: boolean, nonce: number | null, used: number | null }} seen
 * @returns {{ state: string, actions: ("again" | "cancel")[] }}
 */
export function classify({ receipt, known, nonce, used }) {
  if (receipt === "success") return { state: CONFIRMED, actions: [] };
  if (receipt === "reverted") return { state: REVERTED, actions: [] };
  const slot = Number.isInteger(nonce) && /** @type {number} */ (nonce) >= 0 ? nonce : null;
  if (slot !== null && Number.isInteger(used) && /** @type {number} */ (used) > slot)
    return { state: REPLACED, actions: [] };
  if (slot === null) return { state: UNKNOWN, actions: [] };
  if (known) return { state: WAITING, actions: ["cancel"] };
  return { state: MISSING, actions: ["again", "cancel"] };
}

/**
 * Where a cancel stands: the cancel's own receipt, and the original's.
 * The original can still win the slot, and then it is simply confirmed.
 *
 * @param {{ original: "success" | "reverted" | null, cancel: "success" | "reverted" | null }} receipts
 * @returns {string}
 */
export function cancelState({ original, cancel }) {
  if (original === "success") return CONFIRMED;
  if (original === "reverted") return REVERTED;
  if (cancel === "success" || cancel === "reverted") return CANCELLED;
  return "cancelling";
}

/** What each state means, in a sentence for the owner. */
export const EXPLAIN = {
  [CONFIRMED]: "This transaction went through.",
  [REVERTED]:
    "This transaction reached the chain and was refused, so nothing moved except the network fee.",
  [WAITING]:
    "The network has this transaction but hasn't included it yet, usually because an earlier one from this wallet is missing. You can cancel it.",
  [MISSING]:
    "This transaction never reached the network, so nothing was sent. Send it again, or cancel it so it can never go through later.",
  [REPLACED]:
    "Another transaction from this wallet took its place, so this one can never go through. Nothing was sent by it.",
  [UNKNOWN]:
    "The network doesn't have this transaction. It was made before Tera kept what it needs to retry safely, so check your balance before paying again.",
  [CANCELLED]: "Cancelled. The original can never go through now.",
};
