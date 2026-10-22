// Push notifications: tell a closed app about a payment.
//
// The watcher in notify.ts already reads token transfers for wallets that are
// listening. A wallet that turned push on is pinned there for as long as it
// has a row, and each transfer it reads is handed to `deliver`, which turns it
// into the words in core/push.js and sends them through the browser's own push
// service, encrypted to that browser, signed with Tera's VAPID key.
//
// Turning push on takes a signature from the wallet over that same file's
// text, so nobody can ask Tera to report on a wallet they don't hold. Turning
// it off takes only the push address, which nobody else has.

import { createHash } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import webpush from "web-push";
import { SUPPORTED_RWA_ASSETS } from "./data/assets";
import pool from "./db";
import { env } from "./env";
import { logEvent } from "./logging";
import { onTransfers, pin, unpin } from "./notify";
import type { TransferEvent } from "./notify-core";
import {
  DETAILS,
  DEVICE_CHARS,
  LANGUAGES,
  MAX_DEVICES,
  OPEN_URL,
  checkSubscription,
  consentMessage,
  pushText,
  pushesFor,
} from "./push-core";

const SIGNATURE_WINDOW_MS = 5 * 60_000;
/** Wallets pinned in the watcher at most; the rest wait for room. */
const MAX_PINNED = 4_000;

export class PushError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

const must = (condition: unknown, message: string, status = 422) => {
  if (!condition) throw new PushError(message, status);
};

export const enabled = () =>
  Boolean(env.pushEnabled && env.vapidPublicKey && env.vapidPrivateKey && pool);

export function config() {
  return {
    enabled: enabled(),
    publicKey: enabled() ? env.vapidPublicKey : null,
    authority:
      "With push on, Tera keeps this wallet's public address and your browser's push address so it can reach a closed app. It reads token transfers for the wallet and sends a short line through your browser's push service. Turning push off deletes both.",
  };
}

/** The device's name in the signed text, from its push address. */
export const deviceOf = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex").slice(0, DEVICE_CHARS);

/** Known tokens only, by lowercase address. ETH has no Transfer log and is not here. */
export const ASSETS: Record<string, { symbol: string; decimals: number }> = Object.fromEntries(
  SUPPORTED_RWA_ASSETS.filter((a) => a.tokenStandard !== "native").map((a) => [
    a.address.toLowerCase(),
    { symbol: a.symbol, decimals: a.decimals },
  ]),
);

export async function subscribe(body: Record<string, unknown>) {
  must(
    typeof body.address === "string" && isAddress(body.address, { strict: false }),
    "A wallet address is required.",
  );
  const address = getAddress(body.address as string);
  const checked = checkSubscription(body.subscription);
  must(checked.ok, checked.ok ? "" : checked.reason);
  const { endpoint, keys } = (
    checked as { subscription: { endpoint: string; keys: { p256dh: string; auth: string } } }
  ).subscription;
  const detail = DETAILS.includes(String(body.detail)) ? String(body.detail) : "amounts";
  const language = LANGUAGES.includes(String(body.language)) ? String(body.language) : "en";
  const { signature, timestamp } = body;
  must(
    typeof signature === "string" && /^0x[\da-fA-F]{130}$/.test(signature),
    "A wallet signature is required.",
  );
  must(
    typeof timestamp === "number" &&
      Number.isSafeInteger(timestamp) &&
      Math.abs(Date.now() - timestamp) < SIGNATURE_WINDOW_MS,
    "This request has expired. Try again.",
  );
  let valid = false;
  try {
    valid = await verifyMessage({
      address,
      message: consentMessage({
        address,
        device: deviceOf(endpoint),
        detail,
        timestamp: timestamp as number,
      }),
      signature: signature as Hex,
    });
  } catch {
    valid = false;
  }
  must(valid, "That signature did not match this wallet.", 403);
  const lower = address.toLowerCase();
  const devices = await pool!.query(
    "SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE address=$1 AND endpoint<>$2",
    [lower, endpoint],
  );
  must(
    devices.rows[0].n < MAX_DEVICES,
    `Push is on for ${MAX_DEVICES} devices already. Turn it off on one first.`,
    409,
  );
  await pool!.query(
    `INSERT INTO push_subscriptions (endpoint, address, p256dh, auth, detail, language)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (endpoint, address) DO UPDATE SET p256dh=$3, auth=$4, detail=$5, language=$6`,
    [endpoint, lower, keys.p256dh, keys.auth, detail, language],
  );
  pinned(lower);
  return { on: true, detail };
}

export async function unsubscribe(body: Record<string, unknown>) {
  const endpoint = String(body.endpoint ?? "");
  must(endpoint.startsWith("https://"), "That push address isn't valid.");
  const address =
    typeof body.address === "string" && isAddress(body.address, { strict: false })
      ? body.address.toLowerCase()
      : null;
  const removed = await pool!.query(
    address
      ? "DELETE FROM push_subscriptions WHERE endpoint=$1 AND address=$2 RETURNING address"
      : "DELETE FROM push_subscriptions WHERE endpoint=$1 RETURNING address",
    address ? [endpoint, address] : [endpoint],
  );
  for (const row of removed.rows) await unpinIfUnused(row.address);
  return { on: false };
}

let pinnedCount = 0;
const pinnedSet = new Set<string>();
function pinned(address: string) {
  if (pinnedSet.has(address)) return;
  if (pinnedCount >= MAX_PINNED) {
    logEvent("warn", undefined, "push.pin_full", {});
    return;
  }
  pinnedSet.add(address);
  pinnedCount++;
  pin([address]);
}

async function unpinIfUnused(address: string) {
  const left = await pool!.query("SELECT 1 FROM push_subscriptions WHERE address=$1 LIMIT 1", [
    address,
  ]);
  if (left.rowCount) return;
  pinnedSet.delete(address);
  pinnedCount = Math.max(0, pinnedCount - 1);
  unpin(address);
}

type Row = {
  endpoint: string;
  address: string;
  p256dh: string;
  auth: string;
  detail: string;
  language: string;
};
type Sender = (row: Row, payload: string) => Promise<void>;

/**
 * The pushes owed for a batch of transfers, per device: pure, so the tests
 * can hold it to core/push.js without a push service.
 */
export function plan(events: TransferEvent[], rows: Row[]) {
  const out: { row: Row; payload: string }[] = [];
  for (const row of rows) {
    for (const push of pushesFor(events, row.address, ASSETS)) {
      const words = pushText(push, { detail: row.detail, language: row.language });
      out.push({
        row,
        payload: JSON.stringify({ ...words, tag: push.hash, url: OPEN_URL }),
      });
    }
  }
  return out;
}

const webSender: Sender = async (row, payload) => {
  await webpush.sendNotification(
    { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    payload,
    {
      TTL: 6 * 60 * 60,
      urgency: "high",
      vapidDetails: {
        subject: env.vapidSubject,
        publicKey: env.vapidPublicKey,
        privateKey: env.vapidPrivateKey,
      },
    },
  );
};

export async function deliver(events: TransferEvent[], send: Sender = webSender) {
  const parties = [
    ...new Set(events.flatMap((e) => [e.from, e.to]).map((a) => a.toLowerCase())),
  ].filter((a) => pinnedSet.has(a));
  if (!parties.length) return;
  const found = await pool!.query("SELECT * FROM push_subscriptions WHERE address = ANY($1)", [
    parties,
  ]);
  for (const { row, payload } of plan(events, found.rows as Row[])) {
    try {
      await send(row, payload);
      await pool!.query(
        "UPDATE push_subscriptions SET last_sent_at=NOW() WHERE endpoint=$1 AND address=$2",
        [row.endpoint, row.address],
      );
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      // The push service says this device is gone: forget it.
      if (status === 404 || status === 410) {
        await pool!.query("DELETE FROM push_subscriptions WHERE endpoint=$1", [row.endpoint]);
        await unpinIfUnused(row.address);
      } else logEvent("warn", undefined, "push.send_failed", { status: status ?? null });
    }
  }
}

/** On start: pin every wallet with a row, and send pushes as transfers are read. */
export async function startPush() {
  if (!enabled()) return;
  const rows = await pool!.query("SELECT DISTINCT address FROM push_subscriptions");
  for (const row of rows.rows) pinned(row.address);
  onTransfers((events) => void deliver(events).catch(() => {}));
  logEvent("info", undefined, "push.started", { wallets: pinnedSet.size });
}
