// Transaction notifications: hold a wallet's request open until a token
// transfer to or from it lands on chain, then answer at once.
//
// A long-poll, not a socket: the app asks "anything after block N?", and the
// answer comes the moment a transfer is read or after WAIT_MS with nothing.
// Plain fetch on every surface, nothing to keep alive through a proxy.
//
// Nothing is stored. The watcher reads Transfer logs only for wallets that
// have asked in the last couple of minutes, keeps what it read for KEEP_MS so
// a reconnect does not miss it, and stops reading the chain when nobody is
// listening. A request older than what is kept is told so (`gap`), and the app
// reads its history from the explorer instead. Native ETH moves have no log
// and are not seen here; the app's explorer read covers them.

import { createPublicClient, http, toHex } from "viem";
import { env } from "./env";
import { logEvent } from "./logging";
import {
  KEEP_MS,
  TRANSFER_TOPIC,
  WAIT_MS,
  addressTopic,
  checkWait,
  forAddress,
  toEvents,
  type RawLog,
  type TransferEvent,
} from "./notify-core";

const TICK_MS = 1_500;
/** Most blocks read in one pass, so a slow start catches up in steps. */
const MAX_RANGE = 500;
/** A wallet is watched this long after its last request. */
const WATCH_TTL_MS = 2 * 60_000;
const MAX_WATCHED = 5_000;
const MAX_WAITERS = 10_000;
/** Addresses per eth_getLogs topic filter. */
const TOPIC_CHUNK = 200;

export class NotifyError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

export const enabled = () => Boolean(env.notifyEnabled);

export function config() {
  return {
    enabled: enabled(),
    waitMs: WAIT_MS,
    authority:
      "Tera reads token transfers from the chain for wallets that are listening and tells them as they land. It keeps nothing: what it read is dropped after ten minutes, and it stops reading when nobody is listening.",
  };
}

type Kept = TransferEvent & { at: number };
type Waiter = { address: string; after: number; wake: () => void };

const state = {
  /** Last block read; null when not running. */
  head: null as number | null,
  /** Transfers are complete for blocks after this one. */
  floor: null as number | null,
  events: [] as Kept[],
  watched: new Map<string, number>(),
  waiters: new Set<Waiter>(),
  timer: null as ReturnType<typeof setTimeout> | null,
};

const client = createPublicClient({ transport: http(env.rhcRpcUrl, { timeout: 10_000, retryCount: 1 }) });

/** Take in what a pass read up to block `head`, and wake whoever it concerns. */
export function ingest(logs: RawLog[], head: number, now = Date.now()) {
  const known = new Set(state.events.map((e) => `${e.hash}:${e.index}`));
  for (const event of toEvents(logs, new Set(state.watched.keys()))) {
    const key = `${event.hash}:${event.index}`;
    if (known.has(key)) continue;
    known.add(key);
    state.events.push({ ...event, at: now });
  }
  state.head = head;
  if (state.floor === null) state.floor = head;
  const cutoff = now - KEEP_MS;
  while (state.events.length && state.events[0].at < cutoff) {
    const dropped = state.events.shift()!;
    state.floor = Math.max(state.floor, dropped.block);
  }
  for (const waiter of [...state.waiters])
    if (forAddress(state.events, waiter.address, waiter.after).length) waiter.wake();
}

/** What `address` has after block `after`, as far as this watcher knows. */
export function read(address: string, after: number) {
  const head = state.head ?? after;
  return {
    events: forAddress(
      state.events.map(({ at: _at, ...event }) => event),
      address,
      after,
    ),
    cursor: String(Math.max(head, 0)),
    gap: state.floor === null || after < state.floor,
  };
}

function watch(address: string) {
  if (!state.watched.has(address) && state.watched.size >= MAX_WATCHED)
    throw new NotifyError("Notifications are busy. The app will check again shortly.", 503);
  state.watched.set(address, Date.now());
  if (!state.timer) state.timer = setTimeout(tick, 0);
}

function stop() {
  state.head = null;
  state.floor = null;
  state.events = [];
  state.timer = null;
}

async function logsFor(from: number, to: number, topics: (string | string[] | null)[]) {
  return (await (client.request as any)({
    method: "eth_getLogs",
    params: [{ fromBlock: toHex(from), toBlock: toHex(to), topics }],
  })) as RawLog[];
}

async function tick() {
  const now = Date.now();
  for (const [address, seen] of state.watched)
    if (now - seen > WATCH_TTL_MS) state.watched.delete(address);
  if (!state.watched.size && !state.waiters.size) return stop();
  try {
    const latest = Number(await client.getBlockNumber());
    if (state.head === null) ingest([], latest);
    else if (latest > state.head) {
      const from = state.head + 1;
      const to = Math.min(latest, from + MAX_RANGE - 1);
      const topics = [...state.watched.keys()].map(addressTopic);
      const logs: RawLog[] = [];
      for (let i = 0; i < topics.length; i += TOPIC_CHUNK) {
        const chunk = topics.slice(i, i + TOPIC_CHUNK);
        const [incoming, outgoing] = await Promise.all([
          logsFor(from, to, [TRANSFER_TOPIC, null, chunk]),
          logsFor(from, to, [TRANSFER_TOPIC, chunk]),
        ]);
        logs.push(...incoming, ...outgoing);
      }
      ingest(logs, to);
    }
  } catch (error) {
    logEvent("warn", undefined, "notify.read_failed", { message: (error as Error)?.message });
  }
  state.timer = setTimeout(tick, TICK_MS);
}

/**
 * Answer a wait request: at once when there is something (or when `after` is
 * missing, with the block to start from), otherwise when a transfer lands,
 * the client goes away, or WAIT_MS passes.
 */
export async function wait(body: unknown, onClose: (fn: () => void) => void) {
  const q = checkWait(body);
  if (!q.ok) throw new NotifyError(q.reason);
  watch(q.address);
  if (state.head === null) {
    try {
      ingest([], Number(await client.getBlockNumber()));
    } catch {
      throw new NotifyError("The chain could not be reached. The app will check again shortly.", 502);
    }
  }
  if (q.after === null) return { events: [], cursor: String(state.head), gap: false };
  const now = read(q.address, q.after);
  if (now.events.length || now.gap) return now;
  if (state.waiters.size >= MAX_WAITERS) return now;
  const after = q.after;
  return await new Promise<ReturnType<typeof read>>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      state.waiters.delete(waiter);
      state.watched.set(q.address, Date.now());
      resolve(read(q.address, after));
    };
    const waiter: Waiter = { address: q.address, after, wake: finish };
    const timer = setTimeout(finish, WAIT_MS);
    state.waiters.add(waiter);
    onClose(finish);
  });
}

/** For tests: forget everything and stop reading. */
export function reset() {
  if (state.timer) clearTimeout(state.timer);
  state.watched.clear();
  state.waiters.clear();
  stop();
}

/** For tests: watch without starting the reader. */
export function watchOnly(address: string) {
  state.watched.set(address.toLowerCase(), Date.now());
}
