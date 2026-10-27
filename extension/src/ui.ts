// What the popup and the approval window share: a tiny element builder, the
// call to the background worker, the way in before there's a wallet, and
// the theme picker.
// Plain DOM: the extension's pages are small, and Chrome's extension CSP
// allows no inline script, which plain DOM never needs.

import { THEMES, currentTheme, setTheme, type Theme } from "./theme";

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

const THEME_NAMES: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
  black: "Black",
};

/** The four looks side by side, each with a little preview; picking one applies it at once. */
export function themePicker() {
  const row = h("div", { class: "themes", role: "radiogroup", "aria-label": "Theme" });
  const draw = () =>
    row.replaceChildren(
      ...THEMES.map((theme) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            "aria-checked": String(currentTheme() === theme),
            class: currentTheme() === theme ? "on" : "",
            onclick: () => {
              setTheme(theme);
              draw();
            },
          },
          h("span", { class: `swatch ${theme}`, "aria-hidden": "true" }),
          THEME_NAMES[theme],
        ),
      ),
    );
  draw();
  return row;
}

const ICONS: Record<string, string> = {
  send: "M7 17 17 7M9 7h8v8",
  receive: "M17 7 7 17M15 17H7V9",
  swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  stake: "m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5",
};

/** A small line icon, drawn in the text colour. */
export function icon(name: keyof typeof ICONS) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}
