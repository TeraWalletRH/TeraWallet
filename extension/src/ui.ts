// What the popup and the approval window share: a tiny element builder, the
// call to the background worker, and the way in before there's a wallet.
// Plain DOM: the extension's pages are small, and Chrome's extension CSP
// allows no inline script, which plain DOM never needs.

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

export function h(tag: string, props: Props = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function")
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === "class") el.className = String(value);
    else if (key in el && typeof value !== "string")
      (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const child of children)
    if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- replies are shaped per message
export function ask<T = any>(message: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export const header = () =>
  h(
    "header",
    {},
    h("img", { src: "icons/icon-48.png", alt: "" }),
    h("strong", {}, "Tera Wallet"),
    h("span", { class: "net" }, "Robinhood Chain"),
  );

export const errorBox = (text: string) => h("p", { class: "error", role: "alert" }, text);

/**
 * Before there's a wallet: the two ways in, each opening the welcome tab
 * (welcome.ts), since the popup closes whenever it loses focus. `done` runs
 * once a wallet has been added there.
 */
export function setupPrompt(done: () => void) {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area !== "local" || !("vault" in changes)) return;
    chrome.storage.onChanged.removeListener(listener);
    done();
  };
  chrome.storage.onChanged.addListener(listener);
  const open = (start: "create" | "import") => async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`welcome.html?start=${start}`) });
    if (document.body.classList.contains("popup")) window.close();
  };
  return h(
    "div",
    { class: "stack setup" },
    h("img", { src: "icons/icon-128.png", alt: "" }),
    h("h1", {}, "Welcome to Tera"),
    h(
      "p",
      { class: "muted" },
      "Set up a wallet to hold, send and swap on Robinhood Chain and connect to sites.",
    ),
    h(
      "button",
      { class: "primary big", type: "button", onclick: open("create") },
      "Create a new wallet",
    ),
    h(
      "button",
      { class: "big", type: "button", onclick: open("import") },
      "I already have a wallet",
    ),
  );
}
