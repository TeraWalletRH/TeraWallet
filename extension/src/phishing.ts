// Known-phishing domains: fetched, cached, and checked before a site is
// allowed to connect.
//
// core/phishing-list.js answers "is this hostname on the list"; this file
// owns the one thing that module deliberately doesn't -- where the list
// comes from. It is MetaMask's own maintained, open-source blocklist
// (github.com/MetaMask/eth-phishing-detect), the same dataset several other
// wallets already build on, fetched as plain JSON data over a CORS-open URL.
// Nothing here executes what comes back; it is read as an array of strings
// and nothing else.
//
// Cached in chrome.storage.local and refreshed at most once a day. The first
// check after install waits for that one fetch, so the list is live from the
// start; every check after that uses whatever is cached and kicks off a
// refresh in the background when it's stale, so a slow or failed fetch never
// delays a connection request. A fetch that fails leaves the previous list in
// place -- a network blip is a reason to try again later, not a reason to
// start refusing (or stop warning about) every connection in the meantime.

import { hostnameOf, isListed } from "../../public/tera/core/phishing-list.js";

const SOURCE_URL = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

let cachedList: Set<string> | null = null;
let cachedAt = 0;
let refreshing: Promise<void> | null = null;

async function loadCache(): Promise<{ list: string[]; at: number }> {
  const { phishingList, phishingListAt } = await chrome.storage.local.get([
    "phishingList",
    "phishingListAt",
  ]);
  return {
    list: Array.isArray(phishingList) ? (phishingList as string[]) : [],
    at: typeof phishingListAt === "number" ? phishingListAt : 0,
  };
}

async function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const response = await fetch(SOURCE_URL);
      const data = (await response.json()) as { blacklist?: unknown };
      const list = Array.isArray(data?.blacklist)
        ? data.blacklist.filter((entry): entry is string => typeof entry === "string")
        : [];
      if (!list.length) return;
      const at = Date.now();
      await chrome.storage.local.set({ phishingList: list, phishingListAt: at });
      cachedList = new Set(list);
      cachedAt = at;
    } catch {
      // Keep whatever is cached. See the file header for why.
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Whether a site is on the known-phishing list. Never throws. */
export async function isKnownPhishing(origin: string): Promise<boolean> {
  if (cachedList === null) {
    const { list, at } = await loadCache();
    cachedList = new Set(list);
    cachedAt = at;
    if (at === 0) await refresh();
  } else if (Date.now() - cachedAt > REFRESH_INTERVAL_MS) {
    void refresh();
  }
  return isListed(hostnameOf(origin), cachedList ?? new Set());
}
