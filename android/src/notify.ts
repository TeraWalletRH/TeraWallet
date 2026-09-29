// Transaction notifications, as this app hears them. See core/notify.js.
//
// The app keeps one request open with Tera at a time, "anything after block
// N?", and announces what comes back. On the web, when the tab is in the
// background and the owner has allowed it, the browser shows the announcement
// as a system notification too. On the phone it is shown while Tera is open;
// a closed app is told nothing until it opens and reads its history.

import { Platform } from "react-native";
import { api } from "./api";
import * as core from "../../public/tera/core/notify.js";

export { core };

export type Heard = {
  hash: string;
  direction: "send" | "receive";
  symbol: string;
  amount: string;
  /** A full address when heard from Tera, a shortened one from the explorer. */
  counterparty: string;
  timestamp?: number;
};

let available = false;
export const notifyAvailable = () => available;

/** Asked on launch. A failure leaves the fast path off; the explorer read still runs. */
export async function loadNotifyConfig() {
  try {
    available = Boolean((await api("/api/notify/config")).enabled);
  } catch {
    available = false;
  }
  return available;
}

/** One wait: transfers after block `after`, or, with no `after`, the block to start from. */
export async function waitOnce(address: string, after: string | null) {
  return (await api("/api/notify/wait", { address, after })) as {
    events: any[];
    cursor: string;
    gap: boolean;
  };
}

const Browser = () =>
  Platform.OS === "web" ? ((globalThis as any).Notification as any) : undefined;

/** "granted", "denied", "default", or "unsupported" where there is no browser to ask. */
export const systemPermission = (): string => Browser()?.permission ?? "unsupported";

export async function askSystem() {
  const N = Browser();
  if (!N) return "unsupported";
  try {
    return String(await N.requestPermission());
  } catch {
    return String(N.permission);
  }
}

/** A browser notification, only while the tab is out of sight — in sight, the in-app banner says it. */
export function showSystem(title: string, body: string, tag: string, onOpen: () => void) {
  const N = Browser();
  if (!N || N.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    const note = new N(title, { body, tag });
    note.onclick = () => {
      (globalThis as any).focus?.();
      onOpen();
      note.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker; the banner still shows.
  }
}
