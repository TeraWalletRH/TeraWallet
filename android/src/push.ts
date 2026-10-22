// Push notifications, as this app turns them on. See core/push.js for what
// Tera keeps and what a push may say.
//
// The web wallet only, for now: the browser's own push service, through the
// service worker in web/sw.js. iPhone Safari offers it once Tera is added to
// the Home Screen. The phone app needs its own push keys (Firebase, Apple)
// before it can join, so it reports "unsupported" here.

import { Platform } from "react-native";
import { api } from "./api";
import * as vault from "./storage";
import * as core from "../../public/tera/core/push.js";

export { core };

export type Detail = "amounts" | "quiet";
/** "ready", "install" (iPhone Safari, not on the Home Screen yet), "blocked", or "unsupported". */
export type Support = "ready" | "install" | "blocked" | "unsupported";

let publicKey: string | null = null;
export const pushAvailable = () => Boolean(publicKey);

/** Asked on launch. A failure hides the switch rather than offering one that cannot work. */
export async function loadPushConfig() {
  if (Platform.OS !== "web") return false;
  try {
    const config = await api("/api/push/config");
    publicKey = config.enabled && typeof config.publicKey === "string" ? config.publicKey : null;
  } catch {
    publicKey = null;
  }
  return pushAvailable();
}

const g = globalThis as any;

export function pushSupport(): Support {
  if (Platform.OS !== "web" || !g.navigator?.serviceWorker || !g.Notification) return "unsupported";
  const standalone =
    g.matchMedia?.("(display-mode: standalone)")?.matches || g.navigator.standalone === true;
  const iOS = /iPhone|iPad|iPod/.test(g.navigator.userAgent || "");
  if (!g.PushManager) return iOS && !standalone ? "install" : "unsupported";
  if (g.Notification.permission === "denied") return "blocked";
  return "ready";
}

const fromBase64Url = (text: string) => {
  const base64 = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

async function deviceOf(endpoint: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, core.DEVICE_CHARS);
}

/**
 * Turn push on for the unlocked wallet on this browser, or change what the
 * lock screen shows: asks the browser, then signs core/push.js's text with
 * the wallet so Tera knows the request is the owner's. Returns the endpoint.
 */
export async function turnOn(detail: Detail, language: string) {
  if (!publicKey) throw new Error("Push notifications aren't available right now.");
  const permission = await g.Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "Notifications are blocked for this site. Allow them in your browser's site settings.",
    );
  // Not serviceWorker.ready: the wallet opens at /app, outside the worker's
  // /app/ scope, and `ready` waits only for a worker that controls the page.
  const registration =
    (await g.navigator.serviceWorker.getRegistration("/app/")) ||
    (await g.navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }));
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription)
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(publicKey),
    });
  const json = subscription.toJSON();
  const account = vault.currentAccount();
  const timestamp = Date.now();
  const signature = await account.signMessage({
    message: core.consentMessage({
      address: account.address,
      device: await deviceOf(json.endpoint),
      detail,
      timestamp,
    }),
  });
  await api("/api/push/subscribe", {
    address: account.address,
    subscription: { endpoint: json.endpoint, keys: json.keys },
    detail,
    language: language === "zh" ? "zh" : "en",
    timestamp,
    signature,
  });
  return json.endpoint as string;
}

/**
 * Turn push off for one wallet on this browser. The browser's subscription is
 * kept, since another wallet here may still use it; Tera deletes the row.
 */
export async function turnOff(endpoint: string, address: string) {
  await api("/api/push/unsubscribe", { endpoint, address });
}

async function browserEndpoint(): Promise<{ endpoint: string; subscription: any } | null> {
  if (Platform.OS !== "web" || !g.navigator?.serviceWorker) return null;
  try {
    const registration = await g.navigator.serviceWorker.getRegistration("/app/");
    const subscription = await registration?.pushManager?.getSubscription();
    return subscription ? { endpoint: subscription.endpoint, subscription } : null;
  } catch {
    return null;
  }
}

/** A wallet deleted from this browser: Tera stops pushing for it here. Best effort. */
export async function forgetWallet(address: string) {
  const found = await browserEndpoint();
  if (found) await turnOff(found.endpoint, address).catch(() => {});
}

/**
 * The whole wallet erased from this browser: every wallet's row for it goes,
 * and the browser drops the subscription, so the push service refuses Tera
 * from now on even if the request above never arrived. Best effort.
 */
export async function forgetBrowser() {
  const found = await browserEndpoint();
  if (!found) return;
  await api("/api/push/unsubscribe", { endpoint: found.endpoint }).catch(() => {});
  await found.subscription.unsubscribe().catch(() => {});
}
