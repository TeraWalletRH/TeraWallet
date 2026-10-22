// Push notifications: told about a payment while Tera is closed.
//
// Everything else in core/notify.js happens while the app is open: it asks
// Tera to watch the wallet for as long as it is listening, and Tera forgets
// it the moment it stops. A push is the one place that cannot work that way.
// To reach a closed app, Tera has to remember which wallet a device wants to
// hear about. So it is off until the owner turns it on, it is opened only by
// a signature from the wallet itself, and what Tera keeps is exactly this:
// the wallet's public address, the push address its browser or phone gave
// it, and whether amounts may show on the lock screen. Turning it off deletes
// that row.
//
// What a push may say, each rule a test:
//
//   Only tokens Tera lists. Anyone can mint a token named "USDG" and send it
//   to anyone; an unknown token is never announced, so a spam airdrop cannot
//   reach a lock screen.
//
//   Never the other address. A push cannot tell a lookalike from the real
//   payer — that takes the owner's contacts and history, which stay on the
//   device — so it names no address at all, and the app sorts it out when it
//   opens (core/poisoning.js).
//
//   No dust in. Incoming amounts under a ten-thousandth of a token are how
//   poisoners plant an address, and nobody needs to be woken for one. Money
//   going out is always announced, whatever the amount: if this wallet's key
//   is being used somewhere else, that is the push that matters most.
//
//   Quiet means quiet. With amounts off, the push says only that something
//   moved, and the amount never leaves Tera at all.

export const DETAILS = ["amounts", "quiet"];
export const LANGUAGES = ["en", "zh"];
/** Devices one wallet may have turned on. */
export const MAX_DEVICES = 10;

const lower = (value) => String(value ?? "").toLowerCase();

/** The device's name in the signed text: the first 16 hex characters of SHA-256(endpoint). */
export const DEVICE_CHARS = 16;

/** What the wallet signs to turn push on for one device. */
export const consentMessage = ({ address, device, detail, timestamp }) =>
  [
    "Tera notifications",
    "Action: turn on push for this device",
    `Wallet: ${lower(address)}`,
    `Device: ${lower(device)}`,
    `Lock screen: ${detail === "quiet" ? "no amounts" : "amounts"}`,
    `Time: ${timestamp}`,
  ].join("\n");

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * A push subscription as a browser hands it over, checked:
 * { endpoint, keys: { p256dh, auth } }. Returns { ok, subscription } or
 * { ok: false, reason }.
 */
export function checkSubscription(input) {
  const endpoint = String(input?.endpoint ?? "");
  let url = null;
  try {
    url = new URL(endpoint);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || endpoint.length > 1024)
    return { ok: false, reason: "That push address isn't valid." };
  const p256dh = String(input?.keys?.p256dh ?? "");
  const auth = String(input?.keys?.auth ?? "");
  if (!BASE64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100)
    return { ok: false, reason: "That push key isn't valid." };
  if (!BASE64URL.test(auth) || auth.length < 16 || auth.length > 32)
    return { ok: false, reason: "That push key isn't valid." };
  return { ok: true, subscription: { endpoint, keys: { p256dh, auth } } };
}

/** Whether an incoming amount is worth a push: at least 0.0001 of the token. */
export function worthPushing(units, decimals, direction) {
  if (direction === "send") return true;
  const floor = Number(decimals) >= 4 ? 10n ** BigInt(Number(decimals) - 4) : 1n;
  return BigInt(units) >= floor;
}

/** A base-unit amount, trimmed to at most 6 decimals: "1,234.5". Same as core/notify.js. */
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
 * Transfers for one wallet, as pushes: one per transaction, direction and
 * token, so a swap's legs or a batch to the same token are one line.
 * events: { hash, token, from, to, value }. assets: lowercase token address →
 * { symbol, decimals }. Unknown tokens and dust are left out.
 */
export function pushesFor(events, address, assets) {
  const me = lower(address);
  const byKey = new Map();
  for (const e of events || []) {
    const direction = lower(e.to) === me ? "receive" : lower(e.from) === me ? "send" : null;
    const asset = assets?.[lower(e.token)];
    if (!direction || !asset) continue;
    const key = `${lower(e.hash)}|${direction}|${lower(e.token)}`;
    const current = byKey.get(key);
    if (current) current.units += BigInt(e.value);
    else
      byKey.set(key, {
        hash: lower(e.hash),
        direction,
        symbol: asset.symbol,
        decimals: asset.decimals,
        units: BigInt(e.value),
      });
  }
  return [...byKey.values()]
    .filter((p) => p.units > 0n && worthPushing(p.units, p.decimals, p.direction))
    .map((p) => ({ ...p, units: p.units.toString(), amount: formatAmount(p.units, p.decimals) }));
}

/** The words on the lock screen. */
export function pushText(
  { direction, symbol, amount },
  { detail = "amounts", language = "en" } = {},
) {
  const zh = language === "zh";
  if (detail === "quiet")
    return zh
      ? { title: "Tera", body: "你的钱包有新动态。打开 Tera 查看。" }
      : { title: "Tera", body: "Something moved in your wallet. Open Tera to see it." };
  if (direction === "send")
    return zh
      ? {
          title: `已发送 ${amount} ${symbol}`,
          body: "从你的钱包发出。如果不是你操作的，请立即打开 Tera。",
        }
      : {
          title: `Sent ${amount} ${symbol}`,
          body: "From your wallet. If this wasn't you, open Tera now.",
        };
  return zh
    ? { title: `收到 ${amount} ${symbol}`, body: "打开 Tera 查看付款方。" }
    : { title: `Received ${amount} ${symbol}`, body: "Open Tera to see who sent it." };
}

/** Where tapping a push opens the web wallet. */
export const OPEN_URL = "/app/?open=notifications";
