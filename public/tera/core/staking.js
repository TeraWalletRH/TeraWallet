// TERA staking from the wallet: the arithmetic and bookkeeping both surfaces
// need, with no network access of its own.
//
// A stake is two things that happen apart. First the owner sends TERA to the
// staking pool — an ordinary token transfer, reviewed and signed like any other.
// Then the staking service reads that transfer back from the chain, once it has
// enough confirmations, and credits it: to a flexible position, or to a fixed
// lock with a guaranteed reward. Between the two the deposit is pending, and a
// pending deposit is remembered on the device and retried until it is credited,
// so closing the app between signing and crediting loses nothing.
//
// The rules, each one a test:
//
//   The transfer the owner signs is exactly the one asked for: TERA, to the pool
//   the service named, for the amount entered — checked here, on the device,
//   not taken on the service's word.
//
//   A fixed lock's reward is the service's own formula, so the projection shown
//   before signing is the reward that will be recorded.
//
//   The flexible rate is variable and is only ever shown as an estimate: it is
//   this epoch's reward rate spread over everything staked right now, and it
//   falls as others stake.

/** Fixed lock terms the service offers, by days. Mirrors backend/src/staking.ts. */
export const FIXED_TERMS = {
  30: { days: 30, apyBps: 600 },
  45: { days: 45, apyBps: 900 },
  90: { days: 90, apyBps: 1400 },
};

/** How long a deposit may wait to be credited before the screen says to ask for help. */
export const PENDING_HELP_MS = 30 * 60_000;
const SECONDS_PER_YEAR = 31_536_000n;
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const lower = (value) => String(value ?? "").toLowerCase();

/** The guaranteed reward on a fixed lock, in TERA's smallest units. */
export function fixedReward(principal, days) {
  const term = FIXED_TERMS[days];
  const amount = BigInt(principal);
  if (!term || amount <= 0n) return 0n;
  return (amount * BigInt(term.apyBps) * BigInt(term.days)) / 3_650_000n;
}

/**
 * The flexible rate as a yearly percentage: the epoch's reward per second over
 * a year, divided by what is staked now. Null when nothing is staked or the
 * epoch is not running — there is no honest figure to show.
 *
 * `extra` is the owner's own deposit, so the estimate includes the dilution
 * their stake causes.
 */
export function flexibleApr(epoch, extra = 0n) {
  if (!epoch || epoch.status !== "active") return null;
  const rate = BigInt(epoch.reward_rate_per_second || "0");
  const staked = BigInt(epoch.total_active_stake || "0") + BigInt(extra);
  if (rate <= 0n || staked <= 0n) return null;
  // Basis points of a percent, kept in integers until the end.
  const bps = (rate * SECONDS_PER_YEAR * 1_000_000n) / staked;
  return Number(bps) / 10_000;
}

/** The epoch new flexible stakes go into: the active one ending last, or null. */
export function activeEpoch(epochs) {
  const live = (epochs || []).filter((epoch) => epoch?.status === "active");
  live.sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at));
  return live[0] ?? null;
}

/**
 * Check a prepared deposit against what the owner asked for. Returns "" when it
 * matches, or the reason it does not.
 *
 * ERC-20 transfer calldata is the selector a9059cbb, the recipient and the
 * amount, each as a 32-byte word.
 */
export function depositIssue(tx, { token, pool, amount, chainId }) {
  if (!tx || typeof tx !== "object") return "The service did not return a transaction.";
  if (!ADDRESS.test(token) || !ADDRESS.test(pool)) return "The staking pool is not known.";
  if (lower(tx.to) !== lower(token)) return "The transaction is not a TERA transfer.";
  if (BigInt(tx.value || "0") !== 0n) return "A deposit must not send ETH.";
  if (chainId !== undefined && Number(tx.chainId) !== Number(chainId))
    return "The transaction is for a different network.";
  const expected = `0xa9059cbb${lower(pool).slice(2).padStart(64, "0")}${BigInt(amount)
    .toString(16)
    .padStart(64, "0")}`;
  if (lower(tx.data) !== expected)
    return "The transaction does not send exactly this amount to the staking pool.";
  return "";
}

/** Keep only well-formed pending deposits. */
export function cleanPending(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter((entry) => {
    if (!entry || !HASH.test(entry.txHash) || seen.has(lower(entry.txHash))) return false;
    if (entry.kind !== "flexible" && entry.kind !== "fixed") return false;
    if (entry.kind === "fixed" && !FIXED_TERMS[entry.termDays]) return false;
    if (entry.kind === "flexible" && typeof entry.epochId !== "string") return false;
    if (!ADDRESS.test(entry.owner)) return false;
    seen.add(lower(entry.txHash));
    return true;
  });
}

/** Remember a signed deposit until it is credited. */
export function addPending(list, entry) {
  const clean = cleanPending(list).filter((item) => lower(item.txHash) !== lower(entry.txHash));
  return cleanPending([...clean, { ...entry, at: entry.at ?? Date.now() }]);
}

/** Forget a deposit once the service has credited it. */
export const resolvePending = (list, txHash) =>
  cleanPending(list).filter((item) => lower(item.txHash) !== lower(txHash));

/** The pending deposits that belong to this wallet. */
export const pendingFor = (list, owner) =>
  cleanPending(list).filter((item) => lower(item.owner) === lower(owner));

/** Where to credit a pending deposit, and with what. */
export function creditRequest(entry) {
  return entry.kind === "fixed"
    ? {
        path: "/api/staking/locks",
        body: { walletAddress: entry.owner, txHash: entry.txHash, termDays: entry.termDays },
      }
    : {
        path: "/api/staking/deposits",
        body: { epochId: entry.epochId, walletAddress: entry.owner, txHash: entry.txHash },
      };
}

/** "Credited", "Waiting for confirmations", or a reason worth showing. */
export function creditOutcome(response) {
  if (response?.status === "awaiting_confirmations") return "waiting";
  if (response?.success) return "credited";
  return "error";
}
