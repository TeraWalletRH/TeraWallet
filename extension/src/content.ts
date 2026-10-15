// The relay between a site's page and the background worker. Holds no key
// and no logic: it carries requests one way and answers and events the other.
//
// The background learns which site is asking from Chrome (the port's sender),
// never from anything in the message, so a page cannot claim to be another.

const TO_CONTENT = "tera:to-content";
const TO_PAGE = "tera:to-page";
const RECHECK = "tera:recheck";

let port: chrome.runtime.Port | null = null;
// Requests sent on the current port and not yet answered, so they can be
// failed (not left hanging) if the background worker goes away.
const inFlight = new Map<string, string>();
// The addresses this page last saw, so a change made while the background
// was asleep (a disconnect from the popup) still reaches the site.
let seen: string | null = null;

function toPage(message: Record<string, unknown>) {
  window.postMessage({ target: TO_PAGE, ...message }, location.origin);
}

function note(accounts: unknown, announce: boolean) {
  if (!Array.isArray(accounts)) return;
  const now = JSON.stringify(accounts);
  if (announce && seen !== null && seen !== now)
    toPage({ event: "accountsChanged", data: accounts });
  seen = now;
}

function connect() {
  const next = chrome.runtime.connect({ name: "tera-provider" });
  next.onMessage.addListener((message) => {
    if (message?.id) inFlight.delete(message.id);
    if (message?.event === "accountsChanged") note(message.data, false);
    if (typeof message?.id === "string" && message.id.startsWith(RECHECK)) {
      note(message.result, true);
      return;
    }
    if (message?.method === "eth_accounts" || message?.method === "eth_requestAccounts")
      note(message.result, false);
    toPage(message);
  });
  next.onDisconnect.addListener(() => {
    if (port === next) port = null;
    for (const [id, method] of inFlight)
      if (!id.startsWith(RECHECK))
        toPage({ id, method, error: { code: 4900, message: "Tera Wallet restarted. Try again." } });
    inFlight.clear();
  });
  return next;
}

function send(id: string, request: unknown) {
  try {
    port ??= connect();
    inFlight.set(id, String((request as { method?: unknown })?.method));
    port.postMessage({ id, request });
  } catch {
    // The extension was updated or removed under this page.
    if (!id.startsWith(RECHECK))
      toPage({
        id,
        error: { code: 4900, message: "Tera Wallet isn't available. Reload the page." },
      });
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.target !== TO_CONTENT || typeof data.id !== "string") return;
  send(data.id, data.request);
});

// Coming back to the page (after the popup closes, or from another tab):
// ask again, and tell the site if its access changed meanwhile.
const recheck = () => {
  if (seen !== null && document.visibilityState === "visible")
    send(`${RECHECK}:${crypto.randomUUID()}`, { method: "eth_accounts" });
};
window.addEventListener("focus", recheck);
document.addEventListener("visibilitychange", recheck);

// Connect up front so a disconnect from the popup reaches the site live.
try {
  port = connect();
} catch {
  // The extension is reloading; the first request will connect instead.
}

export {};
