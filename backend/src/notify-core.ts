// The backend's copy of the watching half of public/tera/core/notify.js: which
// logs are transfers worth telling a wallet about, and what a wait request
// asks for. tests/notify.test.ts holds the two copies to the same answers.

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const WAIT_MS = 20_000;
export const KEEP_MS = 10 * 60_000;

export type TransferEvent = {
  hash: string;
  block: number;
  index: number;
  token: string;
  from: string;
  to: string;
  value: string;
};

export type RawLog = {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string | number | bigint;
  logIndex?: string | number | bigint;
  transactionHash?: string;
  removed?: boolean;
};

const lower = (value: unknown) => String(value ?? "").toLowerCase();
const topicAddress = (topic: unknown) => `0x${String(topic ?? "").slice(-40)}`.toLowerCase();
const isAddress = (value: unknown) => /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ""));

export const addressTopic = (address: string) => `0x${"0".repeat(24)}${lower(address).slice(2)}`;

export function toEvents(logs: RawLog[], watched: Set<string>): TransferEvent[] {
  const events: TransferEvent[] = [];
  for (const log of logs || []) {
    const topics = log?.topics || [];
    if (log?.removed) continue;
    if (lower(topics[0]) !== TRANSFER_TOPIC || topics.length !== 3) continue;
    const from = topicAddress(topics[1]);
    const to = topicAddress(topics[2]);
    if (!watched.has(from) && !watched.has(to)) continue;
    let value: bigint;
    try {
      value = BigInt(log.data as string);
    } catch {
      continue;
    }
    if (value <= 0n) continue;
    events.push({
      hash: lower(log.transactionHash),
      block: Number(BigInt(log.blockNumber as string)),
      index: Number(BigInt(log.logIndex ?? 0)),
      token: lower(log.address),
      from,
      to,
      value: value.toString(),
    });
  }
  return events.sort((a, b) => a.block - b.block || a.index - b.index);
}

export function forAddress(events: TransferEvent[], address: string, after: number) {
  const me = lower(address);
  const floor = Number(after);
  return (events || [])
    .filter((e) => e.block > floor && (e.to === me || e.from === me))
    .map((e) => ({ ...e, direction: e.to === me ? ("receive" as const) : ("send" as const) }));
}

export function checkWait(
  body: any,
): { ok: false; reason: string } | { ok: true; address: string; after: number | null } {
  if (!isAddress(body?.address)) return { ok: false, reason: "Enter a wallet address." };
  const raw = body?.after;
  if (raw === undefined || raw === null || raw === "")
    return { ok: true, address: lower(body.address), after: null };
  if (!/^\d{1,15}$/.test(String(raw)))
    return { ok: false, reason: "The block to read after is not a block number." };
  return { ok: true, address: lower(body.address), after: Number(raw) };
}
