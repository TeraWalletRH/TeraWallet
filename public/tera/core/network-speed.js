// How fast the network is right now, and how fast a transaction was.
//
// The app asks Robinhood Chain for its newest block, times the answer, and
// compares that block with one a little older. Three numbers come out:
//
//   latency     how long the node took to answer this device — the part the
//               owner's own connection adds;
//   block time  how often the chain makes a block, averaged, which is about
//               how long a signed transaction waits to be included;
//   block age   how long ago the newest block was made; a chain that has
//               stopped making blocks shows it here first.
//
// A transaction's own speed is the time from when it was signed on this device
// to the timestamp of the block that included it. The chain stamps blocks in
// whole seconds, so anything under a second reads as "under 1s" rather than a
// precise number the data cannot support. A row read from the explorer was not
// signed here, so its signing time is unknown and no speed is claimed for it.

/** How many blocks back the average block time is measured over. */
export const SAMPLE_BLOCKS = 100;
/** How often the app checks, while it is open and in view. */
export const PROBE_MS = 15_000;

/** Levels, best first. */
export const LEVELS = ["fast", "normal", "slow", "down"];

/** Average milliseconds per block between two blocks, or null when it cannot be told. */
export function blockTime(newest, older) {
  const blocks = Number(newest?.number) - Number(older?.number);
  const seconds = Number(newest?.timestamp) - Number(older?.timestamp);
  if (!(blocks > 0) || !(seconds >= 0)) return null;
  return (seconds * 1000) / blocks;
}

/**
 * The level the label shows.
 *
 * Down: no answer, or no new block for a minute. Slow: over 1.5s to answer,
 * blocks over 5s apart, or the newest block 20s old. Normal: over 400ms to
 * answer or blocks over 2s apart. Fast otherwise.
 */
export function rate({ latencyMs, blockTimeMs, blockAgeMs } = {}) {
  if (latencyMs == null || !Number.isFinite(latencyMs)) return "down";
  if (blockAgeMs != null && blockAgeMs > 60_000) return "down";
  if (latencyMs > 1500 || (blockTimeMs ?? 0) > 5000 || (blockAgeMs ?? 0) > 20_000) return "slow";
  if (latencyMs > 400 || (blockTimeMs ?? 0) > 2000) return "normal";
  return "fast";
}

/**
 * About how long a transaction sent now takes to confirm: the round trip to
 * send it, the wait for a block, and the round trip to learn it landed.
 */
export function estimateConfirmMs({ latencyMs, blockTimeMs } = {}) {
  if (latencyMs == null || !Number.isFinite(latencyMs)) return null;
  return Math.round(2 * latencyMs + Math.max(blockTimeMs ?? 1000, 250));
}

/**
 * One reading, from the two blocks, the time the request took, and the gas price.
 * @param {{ newest: any, older: any, latencyMs: number | null, gasPriceWei?: bigint | number | string | null, now?: number }} input
 */
export function reading({ newest, older, latencyMs, gasPriceWei = null, now = Date.now() }) {
  const blockTimeMs = blockTime(newest, older);
  const blockAgeMs =
    newest?.timestamp != null ? Math.max(0, now - Number(newest.timestamp) * 1000) : null;
  const measured = { latencyMs, blockTimeMs, blockAgeMs };
  return {
    ...measured,
    level: rate(measured),
    estimateMs: estimateConfirmMs(measured),
    block: newest?.number != null ? Number(newest.number) : null,
    gasPriceWei: gasPriceWei == null ? null : BigInt(gasPriceWei),
    at: now,
  };
}

/** A reading that failed. */
export const offline = (now = Date.now()) => ({
  latencyMs: null,
  blockTimeMs: null,
  blockAgeMs: null,
  level: "down",
  estimateMs: null,
  block: null,
  gasPriceWei: null,
  at: now,
});

/**
 * How long a transaction took: signed at `signedAt` (ms), included in a block
 * stamped `blockTimestamp` (seconds). Null when either is missing, or when the
 * block claims a time well before the signing (a clock that is off).
 */
export function confirmMs(signedAt, blockTimestamp) {
  if (!signedAt || blockTimestamp == null) return null;
  const ms = Number(blockTimestamp) * 1000 - Number(signedAt);
  if (ms < -5000) return null;
  return Math.max(0, ms);
}

/** "under 1s", "4s", "2m 5s", "1h 3m". Block times are whole seconds, so nothing finer. */
export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  if (ms < 1000) return "under 1s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Latency for the label: "120 ms", "1.4 s". */
export function formatLatency(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Gas price in gwei, trimmed: "0.01", "12.5". */
export function formatGwei(wei) {
  if (wei == null) return "";
  const gwei = Number(BigInt(wei)) / 1e9;
  if (gwei === 0) return "0";
  if (gwei < 0.001) return "<0.001";
  return String(Number(gwei.toPrecision(3)));
}

/** A plain transfer uses 21,000 gas; a token transfer about 65,000. */
export const TRANSFER_GAS = 65_000n;

/** What a token transfer costs in wei at this gas price. */
export const transferFeeWei = (gasPriceWei) =>
  gasPriceWei == null ? null : BigInt(gasPriceWei) * TRANSFER_GAS;

/**
 * A transaction fee for the review: "≈ 0.0000021 ETH (< $0.01)".
 *
 * Shown before signing, as wallets do, so the owner sees what the network will
 * take on top of the amount. Two significant figures of ETH, and the dollar value
 * when ETH has a price — never a dollar figure invented without one.
 *
 * @param {bigint | string | number | null | undefined} feeWei
 * @param {number | null | undefined} [ethUsd]
 */
export function describeFee(feeWei, ethUsd = null) {
  if (feeWei == null) return "";
  const eth = Number(BigInt(feeWei)) / 1e18;
  let ethText = "0";
  if (eth > 0) {
    const digits = Math.min(18, Math.max(0, 1 - Math.floor(Math.log10(eth))));
    ethText = eth.toFixed(digits);
    if (ethText.includes(".")) ethText = ethText.replace(/0+$/, "").replace(/\.$/, "");
  }
  if (!(typeof ethUsd === "number" && Number.isFinite(ethUsd) && ethUsd > 0))
    return `≈ ${ethText} ETH`;
  const usd = eth * ethUsd;
  return `≈ ${ethText} ETH (${usd < 0.01 ? "< $0.01" : `≈ $${usd.toFixed(2)}`})`;
}
