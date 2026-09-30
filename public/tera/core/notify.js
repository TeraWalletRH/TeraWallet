// Transaction notifications: tell the owner the moment money moves in or out.
//
// Two sources, one list. Tera watches the chain for token transfers to and from
// the wallets that are listening and answers a waiting request as soon as one
// lands — seconds, not the next balance refresh. Plain ETH moves carry no
// transfer event, so the app also reads its own history from the explorer on
// a slower beat, and that read catches whatever the fast path missed while the
// app was closed or offline. Both are keyed by transaction hash, so a payment
// seen twice is announced once.
//
// What a notification is not: a confirmation Tera vouches for beyond the
// chain, or a push that reaches a closed app. It is shown while Tera is open —
// in the app, and by the browser's own notifications when the tab is in the
// background and the owner has allowed them.

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** How long a waiting request is held open before it answers empty. */
export const WAIT_MS = 20_000;
/** How long transfers are kept for a listener that reconnects. */
export const KEEP_MS = 10 * 60_000;
/** Most activity announced one by one after a gap; more is summed up. */
export const BURST = 3;

const lower = (value) => String(value ?? "").toLowerCase();
const topicAddress = (topic) => `0x${String(topic ?? "").slice(-40)}`.toLowerCase();
const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ""));

/** An address as a 32-byte log topic. */
export const addressTopic = (address) => `0x${"0".repeat(24)}${lower(address).slice(2)}`;

/**
 * Raw eth_getLogs entries as transfers touching one of `watched` (a Set of
 * lowercase addresses). Anything that is not a well-formed ERC-20 Transfer —
 * wrong topic count (ERC-721 puts the id in a topic), undecodable data, a
 * removed log — is left out.
 */
export function toEvents(logs, watched) {
  const events = [];
  for (const log of logs || []) {
    const topics = log?.topics || [];
    if (log?.removed) continue;
    if (lower(topics[0]) !== TRANSFER_TOPIC || topics.length !== 3) continue;
    const from = topicAddress(topics[1]);
    const to = topicAddress(topics[2]);
    if (!watched.has(from) && !watched.has(to)) continue;
    let value;
    try {
      value = BigInt(log.data);
    } catch {
      continue;
    }
    if (value <= 0n) continue;
    events.push({
      hash: lower(log.transactionHash),
      block: Number(BigInt(log.blockNumber)),
      index: Number(BigInt(log.logIndex ?? 0)),
      token: lower(log.address),
      from,
      to,
      value: value.toString(),
    });
  }
  return events.sort((a, b) => a.block - b.block || a.index - b.index);
}

/**
 * The transfers `address` is party to after block `after`, each with its
 * direction from that wallet's side. A transfer to oneself reads as a receipt.
 */
export function forAddress(events, address, after) {
  const me = lower(address);
  const floor = Number(after);
  return (events || [])
    .filter((e) => e.block > floor && (e.to === me || e.from === me))
    .map((e) => ({ ...e, direction: e.to === me ? "receive" : "send" }));
}

/** Parse the body of a wait request: an address, and optionally a block to read after. */
export function checkWait(body) {
  if (!isAddress(body?.address)) return { ok: false, reason: "Enter a wallet address." };
  const raw = body?.after;
  if (raw === undefined || raw === null || raw === "") return { ok: true, address: lower(body.address), after: null };
  if (!/^\d{1,15}$/.test(String(raw))) return { ok: false, reason: "The block to read after is not a block number." };
  return { ok: true, address: lower(body.address), after: Number(raw) };
}

/**
 * Transfers of one transaction folded into one line per direction and token,
 * so a swap's two legs are not four announcements. `assets` maps a lowercase
 * token address to { symbol, decimals }; an unknown token is left out rather
 * than shown as a number with no name.
 */
export function describe(events, assets) {
  const byKey = new Map();
  for (const e of events || []) {
    const asset = assets?.[lower(e.token)];
    if (!asset) continue;
    const key = `${e.hash}|${e.direction}|${e.token}`;
    const current = byKey.get(key);
    if (current) current.units += BigInt(e.value);
    else
      byKey.set(key, {
        hash: e.hash,
        direction: e.direction,
        symbol: asset.symbol,
        decimals: asset.decimals,
        units: BigInt(e.value),
        counterparty: e.direction === "receive" ? e.from : e.to,
      });
  }
  return [...byKey.values()].map((n) => ({
    ...n,
    amount: formatAmount(n.units, n.decimals),
    units: n.units.toString(),
  }));
}

/** A base-unit amount, trimmed to at most 6 decimals: "1,234.5". */
export function formatAmount(units, decimals) {
  const value = BigInt(units);
  const unit = 10n ** BigInt(decimals);
  const whole = (value / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const shown = Math.min(6, Number(decimals));
  const fraction = (value % unit)
    .toString()
    .padStart(Number(decimals), "0")
    .slice(0, shown)
    .replace(/0+$/, "");
  if (fraction) return `${whole}.${fraction}`;
  return value > 0n && whole === "0" ? `<0.${"0".repeat(shown - 1)}1` : whole;
}

/**
 * Of what was just heard, what to announce: not already announced (`seen`, a
 * Set of hashes), not made by this device (`own`, the hashes in its local
 * history — those already have their own "sent" screen), and not older than
 * `since` when there is a timestamp to judge by.
 */
export function fresh(items, { seen, own, since = 0 }) {
  const out = [];
  const taken = new Set();
  for (const item of items || []) {
    const hash = lower(item.hash);
    if (!hash || seen?.has(hash) || own?.has(hash)) continue;
    if (item.timestamp !== undefined && Number(item.timestamp) < since) continue;
    const key = `${hash}|${item.direction}|${item.symbol ?? ""}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(item);
  }
  return out;
}

/**
 * What to show for a batch: each item on its own when there are a few, or one
 * summary line when a reconnect turns up many.
 */
export function batch(items) {
  if (!items?.length) return null;
  if (items.length <= BURST) return { kind: "each", items };
  const received = items.filter((i) => i.direction === "receive").length;
  return { kind: "summary", received, sent: items.length - received, items };
}
