// What a transaction does to this wallet's balances, read from the chain's
// own simulation of it, not from what the review says it should do. No
// network access of its own; the wallet runs eth_simulateV1 with transfer
// tracing over every step (approval, then swap, in one simulated block) and
// passes the result in.
//
// The rules, each one a test:
//
//   Only this wallet counts. Every token and ETH transfer to or from it, in
//   every step, is added up per asset; what moves between other addresses
//   along the way (a router, a pool) isn't shown.
//
//   A net zero isn't a change: a token that comes in and goes out again in
//   the same transaction is left off.
//
//   A token the wallet doesn't know is still shown, by its own symbol when
//   the chain gives one and its address when it doesn't, and flagged: an
//   unexpected token arriving is exactly what a preview is for.
//
//   NFTs are shown by collection and number. Approvals this wallet gives are
//   shown as permission, "unlimited" when it is.
//
//   A step that fails in the simulation says which step, and nothing else is
//   claimed: half a simulation isn't a preview.
//
//   The network fee isn't a transfer and isn't in the list; the review shows
//   it on its own line.

export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
export const APPROVAL_FOR_ALL =
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";
const UNLIMITED = 2n ** 255n;

const lower = (value) => String(value ?? "").toLowerCase();
const topicAddress = (topic) => `0x${lower(topic).slice(-40)}`;
const word = (data, index = 0) => {
  const hex = lower(data)
    .replace(/^0x/, "")
    .slice(index * 64, index * 64 + 64);
  return hex.length === 64 ? BigInt(`0x${hex}`) : null;
};

/**
 * This wallet's changes from a simulation: { ok, tokens, nfts, approvals }
 * or { ok: false, failedAt, reason }.
 *
 * calls: eth_simulateV1's result[0].calls, one per step: { status, logs, error? }
 *
 * @param {{ status?: string, logs?: { address: string, topics: string[], data: string }[], error?: { message?: string } }[]} calls
 * @param {string} owner
 */
export function changesFrom(calls, owner) {
  const me = lower(owner);
  /** @type {Map<string, bigint>} */
  const tokens = new Map();
  /** @type {{ token: string, id: string, direction: "in" | "out" }[]} */
  const nfts = [];
  /** @type {{ token: string, spender: string, amount: bigint | null, all?: boolean }[]} */
  const approvals = [];
  const list = Array.isArray(calls) ? calls : [];
  if (!list.length) return { ok: false, failedAt: 0, reason: "The simulation returned nothing." };
  for (let i = 0; i < list.length; i++) {
    const call = list[i];
    if (lower(call?.status) !== "0x1")
      return {
        ok: false,
        failedAt: i,
        reason: String(call?.error?.message || "The step was refused in the simulation."),
      };
    for (const log of call.logs ?? []) {
      const topics = (log.topics ?? []).map(lower);
      const token = lower(log.address);
      if (topics[0] === TRANSFER && topics.length === 3) {
        const from = topicAddress(topics[1]);
        const to = topicAddress(topics[2]);
        if (from !== me && to !== me) continue;
        const amount = word(log.data);
        if (amount === null) continue;
        const sign = (to === me ? amount : 0n) - (from === me ? amount : 0n);
        tokens.set(token, (tokens.get(token) ?? 0n) + sign);
      } else if (topics[0] === TRANSFER && topics.length === 4) {
        const from = topicAddress(topics[1]);
        const to = topicAddress(topics[2]);
        if (from === to || (from !== me && to !== me)) continue;
        nfts.push({ token, id: BigInt(topics[3]).toString(), direction: to === me ? "in" : "out" });
      } else if (topics[0] === APPROVAL && topics.length === 3 && topicAddress(topics[1]) === me) {
        approvals.push({ token, spender: topicAddress(topics[2]), amount: word(log.data) });
      } else if (topics[0] === APPROVAL_FOR_ALL && topicAddress(topics[1]) === me) {
        if (word(log.data) === 1n)
          approvals.push({ token, spender: topicAddress(topics[2]), amount: null, all: true });
      }
    }
  }
  for (const [token, delta] of tokens) if (delta === 0n) tokens.delete(token);
  return {
    ok: true,
    tokens: [...tokens].map(([token, delta]) => ({ token, delta })),
    nfts,
    // The last approval per token and spender is the one that stands.
    approvals: [...new Map(approvals.map((a) => [`${a.token}:${a.spender}`, a])).values()].filter(
      (a) => a.all || a.amount !== 0n,
    ),
  };
}

/** Base units as a short decimal: at most 6 significant decimals. */
export function amountText(units, decimals) {
  const negative = units < 0n;
  const value = negative ? -units : units;
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  let frac = (value % unit).toString().padStart(decimals, "0");
  // Keep enough decimals to show something for tiny amounts, then 6 at most past the first digit.
  const first = frac.search(/[1-9]/);
  frac = first === -1 ? "" : frac.slice(0, whole > 0n ? 6 : first + 6).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
// Spenders worth naming: the same address on every chain that has them.
const SPENDERS = {
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Uniswap's Permit2",
};
const spenderName = (address) => SPENDERS[lower(address)] ?? short(address);

/**
 * The changes in the shape the review shows: pays and receives, with
 * symbols, amounts and dollar values where there's a price.
 *
 * known: { [lowercase address]: { symbol, decimals, known?: boolean } } for every token involved,
 *        ETH included under NATIVE. A token missing here is shown by address.
 *
 * @param {ReturnType<typeof changesFrom>} changes
 * @param {{ known?: Record<string, { symbol: string, decimals: number, known?: boolean }>, prices?: Record<string, number> }} [context]
 */
export function describe(changes, { known = {}, prices = {} } = {}) {
  if (!changes.ok)
    return {
      pays: [],
      receives: [],
      approvals: [],
      hasDeltas: false,
      unknownToken: false,
      summary: "",
    };
  const pays = [];
  const receives = [];
  let unknownToken = false;
  for (const { token, delta } of changes.tokens) {
    const meta =
      known[token] ?? (token === NATIVE ? { symbol: "ETH", decimals: 18, known: true } : null);
    if (!meta || !meta.known) unknownToken = true;
    const symbol = meta?.symbol || short(token);
    const amount = meta
      ? amountText(delta < 0n ? -delta : delta, meta.decimals)
      : (delta < 0n ? -delta : delta).toString();
    const price = meta?.known ? prices[meta.symbol] : undefined;
    const usd =
      meta && Number.isFinite(price) && price > 0
        ? (Number(delta < 0n ? -delta : delta) / 10 ** meta.decimals) * price
        : undefined;
    const item = {
      asset: token,
      amount,
      symbol,
      formatted: `${delta < 0n ? "-" : "+"}${amount} ${symbol}`,
      ...(usd !== undefined ? { usd } : {}),
      ...(meta?.known ? {} : { unknown: true }),
    };
    (delta < 0n ? pays : receives).push(item);
  }
  for (const nft of changes.nfts) {
    const meta = known[nft.token];
    const name = meta?.symbol || short(nft.token);
    const item = {
      asset: nft.token,
      amount: "1",
      symbol: name,
      formatted: `${nft.direction === "in" ? "+" : "-"}${name} #${nft.id}`,
    };
    (nft.direction === "in" ? receives : pays).push(item);
  }
  const approvals = changes.approvals.map((a) => {
    const meta = known[a.token];
    const name = meta?.symbol || short(a.token);
    if (a.all) return `Lets ${spenderName(a.spender)} move every ${name} you hold`;
    if (a.amount !== null && a.amount >= UNLIMITED)
      return `Lets ${spenderName(a.spender)} spend unlimited ${name}`;
    return `Lets ${spenderName(a.spender)} spend up to ${meta && a.amount !== null ? amountText(a.amount, meta.decimals) : String(a.amount)} ${name}`;
  });
  const parts = [
    pays.length ? `You send ${pays.map((p) => p.formatted.slice(1)).join(", ")}` : "",
    receives.length ? `you get ${receives.map((r) => r.formatted.slice(1)).join(", ")}` : "",
  ].filter(Boolean);
  const summary = parts.length ? parts.join(" and ") : "No balance changes";
  return {
    pays,
    receives,
    approvals,
    hasDeltas: pays.length + receives.length + approvals.length > 0,
    unknownToken,
    summary: summary.charAt(0).toUpperCase() + summary.slice(1),
  };
}
