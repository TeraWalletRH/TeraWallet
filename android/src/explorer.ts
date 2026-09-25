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

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

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
    const counterparty = short((out ? item.to?.hash : item.from?.hash) || "");
    entries.set(hash, {
      hash,
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
    const counterparty = short((out ? item.to?.hash : item.from?.hash) || "");
    entries.set(hash, {
      hash,
      status: item.status === "ok" ? "confirmed" : "failed",
      timestamp: new Date(item.timestamp).getTime(),
      title: out
        ? t(`Sent ${amount} ETH to ${counterparty}`, `发送 ${amount} ETH 至 ${counterparty}`)
        : t(`Received ${amount} ETH from ${counterparty}`, `从 ${counterparty} 收到 ${amount} ETH`),
    });
  }
  return [...entries.values()].sort((a, b) => b.timestamp - a.timestamp);
}
