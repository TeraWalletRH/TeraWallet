// Staying unlocked: after the password opens a wallet once, Tera can keep
// that wallet's secret for a few minutes so the next request needs only a
// click. The owner picks how long, or "every time" (the default), which keeps
// nothing.
//
// What's kept lives in chrome.storage.session: memory only, readable by this
// extension's own pages and worker and never by a site, gone when Chrome
// closes. The background worker also wipes it when the time is up, when the
// computer locks, and on Lock. Every request still opens a window to confirm:
// staying unlocked skips the password, never the decision.

export const STAY_CHOICES = [0, 5, 15, 60] as const;
export type Stay = (typeof STAY_CHOICES)[number];

export const isStay = (minutes: unknown): minutes is Stay => STAY_CHOICES.includes(minutes as Stay);

export const stayLabel = (minutes: Stay) =>
  minutes === 0 ? "Every time" : minutes === 60 ? "1 hour" : `${minutes} min`;

/** The secrets kept, by address (lowercase), and when they're dropped. */
export type Held = { until: number; secrets: Record<string, string> };

const live = (held: Held | null | undefined, now: number): held is Held =>
  Boolean(held && typeof held.until === "number" && held.until > now && held.secrets);

/**
 * Keep `secret` for `minutes` from now. Wallets already unlocked stay
 * unlocked, on the new clock. Nothing is kept for 0 minutes.
 */
export function hold(
  held: Held | null | undefined,
  address: string,
  secret: string,
  minutes: number,
  now: number,
): Held | null {
  if (!isStay(minutes) || minutes === 0) return null;
  const secrets = live(held, now) ? { ...held.secrets } : {};
  secrets[address.toLowerCase()] = secret;
  return { until: now + minutes * 60_000, secrets };
}

/** The secret kept for `address`, if it's still in time. */
export function heldSecret(held: Held | null | undefined, address: string, now: number) {
  if (!live(held, now)) return null;
  return held.secrets[address.toLowerCase()] ?? null;
}

/** After the owner picks a shorter time (or "every time"): what's left, if anything. */
export function shorten(held: Held | null | undefined, minutes: number, now: number) {
  if (!live(held, now) || !isStay(minutes) || minutes === 0) return null;
  return { ...held, until: Math.min(held.until, now + minutes * 60_000) };
}

/** Forget one wallet (it was removed). */
export function drop(held: Held | null | undefined, address: string, now: number) {
  if (!live(held, now)) return null;
  const secrets = { ...held.secrets };
  delete secrets[address.toLowerCase()];
  return Object.keys(secrets).length ? { ...held, secrets } : null;
}
