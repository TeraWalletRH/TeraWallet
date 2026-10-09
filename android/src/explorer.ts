import { formatUnits, type Address } from "viem";

/**
 * Activity reconstructed from the chain itself, not the local cache.
 *
 * `data.history` is a local, encrypted, per-device file (see storage.ts) —
 * by design, never sent anywhere. That also means a second device (or a
 * reinstall) holding the exact same wallet has no way to show what it did
 * before. Confirmed transfers are already public and permanent on chain,
 * so instead of syncing the private cache anywhere, this reads the same
 * facts back from the block explorer — no new backend, no change to what
 * "never leaves this device" means for the local cache.
 *
 * Bridge/private-send job status (delivery, payout hash) and anything
 * still a draft or pending broadcast are Tera-backend or pre-chain
 * concepts with no on-chain trace, so they can only ever come from
 * data.history on the device that made them — this is a supplement to
 * that, not a replacement for it.
 */
export type ChainHistoryEntry = {
  hash: string;
  title: string;
  direction: "send" | "receive";
  amount: string;
  symbol: string;
  counterparty: string;
  /** The counterparty's full address, so activity search can find it. */
  counterpartyAddress: string;
  status: "confirmed" | "failed";
  timestamp: number;
};

const EXPLORER_API = "https://robinhoodchain.blockscout.com/api/v2";
// Blockscout's Cloudflare bot-fight mode 403s a bare/non-browser User-Agent
// (verified directly: curl with no UA gets a challenge page, the same
// request with one gets real JSON). Not spoofing anything a real device
// wouldn't already send — just making sure this fetch looks like the
// mobile client it actually is.
const EXPLORER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  Accept: "application/json",
};

async function explorerGet(path: string) {
  const response = await fetch(`${EXPLORER_API}${path}`, {
    headers: EXPLORER_HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Explorer request failed (${response.status}).`);
  return response.json();
}

/**
 * Logs matching topic0 and topic1 across every contract, newest-last, from
 * the explorer's Etherscan-style API. The node only searches 30,000 blocks at
 * a time without a contract address, so "every approval this wallet ever
 * gave" is one request here and hundreds there. Pages of 1,000 are followed
 * from the last block seen; a log repeated at a page edge is harmless to
 * callers that keep the newest per key.
 */
export async function explorerLogs(topic0: string, topic1: string): Promise<any[]> {
  const logs: any[] = [];
  let fromBlock = 0;
  for (let page = 0; page < 20; page++) {
    const query = `module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=latest&topic0=${topic0}&topic1=${topic1}&topic0_1_opr=and`;
    const response = await fetch(`${EXPLORER_API.replace(/\/v2$/, "")}?${query}`, {
      headers: EXPLORER_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Explorer request failed (${response.status}).`);
    const body = await response.json();
    // "No records found" is status 0 with an empty result, not a failure.
    if (!Array.isArray(body?.result)) throw new Error("Explorer returned no logs.");
    logs.push(...body.result);
    if (body.result.length < 1000) return logs;
    fromBlock = Number(BigInt(body.result[body.result.length - 1].blockNumber));
  }
  throw new Error("Too many approvals to list.");
}

/** One ERC-20 the wallet holds, as the explorer describes it. See core/spam.js. */
export type FoundToken = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  exchangeRate: string | null;
  reputation: string | null;
  holders: number;
  value: string;
};

/**
 * Every ERC-20 this address holds, known to Tera or not — including whatever
 * was airdropped to it unasked. core/spam.js decides which of these to list.
 */
export async function fetchTokenBalances(address: string): Promise<FoundToken[]> {
  const items = await explorerGet(`/addresses/${address}/token-balances`);
  if (!Array.isArray(items)) throw new Error("Explorer returned no balances.");
  return items
    .filter((item: any) => item?.token?.type === "ERC-20" && item.token.address_hash)
    .map((item: any) => ({
      address: String(item.token.address_hash).toLowerCase(),
      symbol: String(item.token.symbol || "").trim(),
      name: String(item.token.name || "").trim(),
      decimals: Number(item.token.decimals ?? 18),
      exchangeRate: item.token.exchange_rate ?? null,
      reputation: item.token.reputation ?? null,
      holders: Number(item.token.holders_count ?? 0),
      value: String(item.value ?? "0"),
    }));
}

const short =(address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export async function fetchChainHistory(
  address: Address,
  t: (en: string, zh: string) => string,
): Promise<ChainHistoryEntry[]> {
  const lower = address.toLowerCase();
  const [transfers, transactions] = await Promise.all([
    explorerGet(`/addresses/${address}/token-transfers?type=ERC-20`).catch(() => ({ items: [] })),
    explorerGet(`/addresses/${address}/transactions?filter=to%20%7C%20from`).catch(() => ({
      items: [],
    })),
  ]);
  const entries = new Map<string, ChainHistoryEntry>();
  // Token transfers first: they carry the asset/amount that actually
  // moved, which a raw transaction record (value in native currency only)
  // can't tell you for an ERC-20 send.
  for (const item of transfers.items || []) {
    const hash: string = item.transaction_hash;
    if (!hash || entries.has(hash)) continue;
    const out = item.from?.hash?.toLowerCase() === lower;
    const amount = formatUnits(
      BigInt(item.total?.value ?? "0"),
      Number(item.token?.decimals ?? 18),
    );
    const symbol = item.token?.symbol || "?";
    const counterpartyAddress: string = (out ? item.to?.hash : item.from?.hash) || "";
    const counterparty = short(counterpartyAddress);
    entries.set(hash, {
      hash,
      direction: out ? "send" : "receive",
      amount,
      symbol,
      counterparty,
      counterpartyAddress,
      status: "confirmed",
      timestamp: new Date(item.timestamp).getTime(),
      title: out
        ? t(
            `Sent ${amount} ${symbol} to ${counterparty}`,
            `发送 ${amount} ${symbol} 至 ${counterparty}`,
          )
        : t(
            `Received ${amount} ${symbol} from ${counterparty}`,
            `从 ${counterparty} 收到 ${amount} ${symbol}`,
          ),
    });
  }
  // Then native-currency transactions the token transfers didn't already
  // cover — a plain ETH send, or a contract call with no ERC-20 leg.
  for (const item of transactions.items || []) {
    const hash: string = item.hash;
    if (!hash || entries.has(hash) || !item.value || item.value === "0") continue;
    const out = item.from?.hash?.toLowerCase() === lower;
    const amount = formatUnits(BigInt(item.value), 18);
    const counterpartyAddress: string = (out ? item.to?.hash : item.from?.hash) || "";
    const counterparty = short(counterpartyAddress);
    entries.set(hash, {
      hash,
      direction: out ? "send" : "receive",
      amount,
      symbol: "ETH",
      counterparty,
      counterpartyAddress,
      status: item.status === "ok" ? "confirmed" : "failed",
      timestamp: new Date(item.timestamp).getTime(),
      title: out
        ? t(`Sent ${amount} ETH to ${counterparty}`, `发送 ${amount} ETH 至 ${counterparty}`)
        : t(`Received ${amount} ETH from ${counterparty}`, `从 ${counterparty} 收到 ${amount} ETH`),
    });
  }
  return [...entries.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/** One asset moving in or out of the wallet in one transaction. See core/pnl.js. */
export type TransferLeg = {
  hash: string;
  timestamp: number;
  symbol: string;
  amount: string;
  direction: "in" | "out";
};

const LEG_PAGES = 10;

/** Every page of an explorer list, up to a cap. `complete` is false when the cap cut it short. */
async function allPages(path: string) {
  const items: any[] = [];
  let params = "";
  for (let page = 0; page < LEG_PAGES; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await explorerGet(`${path}${params ? `${separator}${params}` : ""}`);
    items.push(...(result.items || []));
    if (!result.next_page_params) return { items, complete: true };
    params = new URLSearchParams(
      Object.entries(result.next_page_params).map(([key, value]) => [key, String(value)]),
    ).toString();
  }
  return { items, complete: false };
}

/**
 * Every leg of every transfer this wallet made or received, for profit and loss
 * and the portfolio chart.
 *
 * Unlike fetchChainHistory, which keeps one line per transaction for the
 * activity list, this keeps both sides of a swap. Tokens are named by contract
 * through `known` (lowercase address → symbol); anything else is skipped, as it
 * is nothing the wallet values. Native ETH comes from the wallet's own
 * transactions (what it sent) and internal transactions (what contracts sent
 * it, such as a swap paying out ETH). Failed transactions move nothing.
 *
 * `complete` is false when the history is longer than this reads; the screen
 * says so rather than presenting a partial history as the whole.
 */
export async function fetchTransferLegs(
  address: Address,
  known: Record<string, string>,
): Promise<{ legs: TransferLeg[]; complete: boolean }> {
  const lower = address.toLowerCase();
  const [tokens, transactions, internal] = await Promise.all([
    allPages(`/addresses/${address}/token-transfers?type=ERC-20`),
    allPages(`/addresses/${address}/transactions`),
    allPages(`/addresses/${address}/internal-transactions`),
  ]);
  const legs: TransferLeg[] = [];
  for (const item of tokens.items) {
    const symbol = known[String(item.token?.address_hash || item.token?.address || "").toLowerCase()];
    const from = String(item.from?.hash || "").toLowerCase();
    const to = String(item.to?.hash || "").toLowerCase();
    if (!symbol || !item.transaction_hash || (from !== lower && to !== lower) || from === to) continue;
    legs.push({
      hash: item.transaction_hash,
      timestamp: new Date(item.timestamp).getTime(),
      symbol,
      amount: formatUnits(BigInt(item.total?.value ?? "0"), Number(item.total?.decimals ?? item.token?.decimals ?? 18)),
      direction: to === lower ? "in" : "out",
    });
  }
  for (const item of transactions.items) {
    if (!item.hash || !item.value || item.value === "0" || item.status !== "ok") continue;
    const from = String(item.from?.hash || "").toLowerCase();
    const to = String(item.to?.hash || "").toLowerCase();
    if (from === to) continue;
    legs.push({
      hash: item.hash,
      timestamp: new Date(item.timestamp).getTime(),
      symbol: "ETH",
      amount: formatUnits(BigInt(item.value), 18),
      direction: from === lower ? "out" : "in",
    });
  }
  for (const item of internal.items) {
    if (!item.transaction_hash || !item.value || item.value === "0" || item.success === false) continue;
    const from = String(item.from?.hash || "").toLowerCase();
    const to = String(item.to?.hash || "").toLowerCase();
    // The wallet's own top-level sends are already counted above.
    if (to !== lower || from === lower) continue;
    legs.push({
      hash: item.transaction_hash,
      timestamp: new Date(item.timestamp).getTime(),
      symbol: "ETH",
      amount: formatUnits(BigInt(item.value), 18),
      direction: "in",
    });
  }
  return {
    legs,
    complete: tokens.complete && transactions.complete && internal.complete,
  };
}
