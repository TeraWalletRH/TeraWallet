// The toolbar popup: the wallet itself. Home shows what it holds and what
// that's worth; Send and Receive move funds; Activity lists what was sent and
// signed; Settings has the connected sites and taking the wallet out.
//
// Nothing here holds a key or decides anything. A send is checked and
// prepared by the background worker and confirmed, with the password, in the
// same review window a site's request opens. The popup closes whenever it
// loses focus, so the view and an unfinished send are kept in session
// storage (memory only, gone when the browser closes) and come back on reopen.

import { encodeQR } from "qr";
import { formatUnits } from "../../public/tera/core/dapp-send.js";
import { feeReserve, maxSendable, dollarsForTokens } from "../../public/tera/core/max-amount.js";
import { impersonates } from "../../public/tera/core/poisoning.js";
import { format as money, totalValue } from "../../public/tera/core/value.js";
import {
  NATIVE,
  checkAmount,
  checkRecipient,
  holdings,
  plainUnits,
  toUnits,
} from "../../public/tera/core/wallet-send.js";
import { originLabel } from "./shared";
import { ask, errorBox, h, header, setupForm, short } from "./ui";

const root = document.getElementById("root")!;

type Signed = { at: number; title: string; site: string; text: string; signature: string };
type Sent = {
  hash: string;
  at: number;
  site: string;
  title: string;
  recipient: string;
  status: string;
};
type State = {
  address: string | null;
  sites: { origin: string; connectedAt: number }[];
  signatures: Signed[];
  transactions: Sent[];
};
type Asset = { symbol: string; name: string; address: string; decimals: number };
type Balances = {
  error?: string;
  address: string;
  assets: Asset[];
  balances: Record<string, string | null>;
  prices: Record<string, number>;
  pricesAt: number;
  maxFeePerGas: string | null;
};
type Row = Asset & { balance: string | null; amount: string | null; value: number | null };
type View = "home" | "send" | "receive" | "activity" | "settings";
type Draft = { asset?: string; to?: string; amount?: string };

let state: State;
let wallet: Balances | null = null;
let view: View = "home";
let draft: Draft = {};

// ------------------------------------------------------------- session ----

async function restore() {
  try {
    const saved = await chrome.storage.session.get(["view", "draft"]);
    if (typeof saved.view === "string") view = saved.view as View;
    if (saved.draft && typeof saved.draft === "object") draft = saved.draft as Draft;
  } catch {
    // No session storage: start on Home.
  }
}
const remember = () => chrome.storage.session.set({ view, draft }).catch(() => {});

function go(next: View) {
  view = next;
  void remember();
  draw();
}

// -------------------------------------------------------------- render ----

async function render() {
  state = await ask<State>({ type: "state" });
  if (!state.address) {
    root.replaceChildren(header(), setupForm(render));
    return;
  }
  draw();
  wallet = await ask<Balances>({ type: "wallet:balances" });
  if (view === "home" || view === "send") draw();
}

function draw() {
  const body =
    view === "send"
      ? sendView()
      : view === "receive"
        ? receiveView()
        : view === "activity"
          ? activityView()
          : view === "settings"
            ? settingsView()
            : homeView();
  root.replaceChildren(header(), tabs(), ...body);
}

function tabs() {
  const tab = (name: View, label: string) =>
    h(
      "button",
      {
        type: "button",
        class:
          view === name || (name === "home" && (view === "send" || view === "receive")) ? "on" : "",
        "aria-current": view === name ? "page" : undefined,
        onclick: () => go(name),
      },
      label,
    );
  return h(
    "nav",
    { class: "tabs" },
    tab("home", "Wallet"),
    tab("activity", "Activity"),
    tab("settings", "Settings"),
  );
}

const rows = (): Row[] =>
  wallet && !wallet.error ? (holdings(wallet.assets, wallet.balances, wallet.prices) as Row[]) : [];

function copyButton(text: string) {
  const button = h("button", { class: "small", type: "button" }, "Copy") as HTMLButtonElement;
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
  return button;
}

// ---------------------------------------------------------------- home ----

function homeView() {
  const list = rows();
  const total = totalValue(
    list.map((row) => ({ symbol: row.symbol, amount: row.amount ?? "" })),
    wallet?.prices ?? {},
  );
  const reading = !wallet;
  const failed = wallet?.error;
  return [
    h(
      "section",
      { class: "card hero" },
      h("span", { class: "muted small" }, "Total value"),
      h("strong", { class: "total" }, reading ? "…" : money(total.total)),
      total.coverage === "partial"
        ? h(
            "span",
            { class: "muted small" },
            `Leaves out ${total.unpriced.map((u: { symbol: string }) => u.symbol).join(", ")}: no price.`,
          )
        : null,
      h(
        "div",
        { class: "row" },
        h("span", { class: "mono grow", title: state.address! }, short(state.address!)),
        copyButton(state.address!),
      ),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "primary", type: "button", onclick: () => go("send") }, "Send"),
        h("button", { type: "button", onclick: () => go("receive") }, "Receive"),
      ),
    ),
    h(
      "section",
      { class: "card" },
      h("strong", {}, "Assets"),
      failed
        ? errorBox(failed)
        : reading
          ? h("p", { class: "muted small" }, "Reading your balances from Robinhood Chain…")
          : h(
              "ul",
              { class: "assets" },
              ...list.map((row) =>
                h(
                  "li",
                  {},
                  h(
                    "div",
                    { class: "grow" },
                    h("strong", {}, row.symbol),
                    h("span", { class: "muted small" }, row.name),
                  ),
                  h(
                    "div",
                    { class: "right" },
                    h(
                      "span",
                      {},
                      row.balance === null
                        ? "Couldn't read"
                        : formatUnits(row.balance, row.decimals),
                    ),
                    h("span", { class: "muted small" }, money(row.value)),
                  ),
                ),
              ),
            ),
    ),
  ];
}

// ---------------------------------------------------------------- send ----

function sendView() {
  const list = rows();
  const back = h("button", { class: "link", type: "button", onclick: () => go("home") }, "← Back");
  if (!wallet) return [back, h("p", { class: "muted" }, "Reading your balances…")];
  if (wallet.error) return [back, errorBox(wallet.error)];

  const select = h(
    "select",
    { "aria-label": "Asset" },
    ...list.map((row) =>
      h(
        "option",
        { value: row.address },
        `${row.symbol} · ${row.balance === null ? "balance unknown" : formatUnits(row.balance, row.decimals)}`,
      ),
    ),
  ) as HTMLSelectElement;
  select.value = list.some((row) => row.address === draft.asset)
    ? draft.asset!
    : (list[0]?.address ?? NATIVE);
  const to = h("input", {
    class: "mono",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "0x…",
    value: draft.to ?? "",
  }) as HTMLInputElement;
  const amount = h("input", {
    inputmode: "decimal",
    autocomplete: "off",
    placeholder: "0.0",
    value: draft.amount ?? "",
  }) as HTMLInputElement;
  const toNote = h("div");
  const amountNote = h("span", { class: "muted small" });
  const status = h("div");
  const review = h("button", { class: "primary", type: "submit" }, "Review") as HTMLButtonElement;

  const asset = () => list.find((row) => row.address === select.value)!;
  const paid = state.transactions.map((sent) => ({ address: sent.recipient }));

  const check = () => {
    draft = { asset: select.value, to: to.value, amount: amount.value };
    void remember();
    // The recipient, checked as it's typed or pasted.
    toNote.replaceChildren();
    const typed = to.value.trim();
    if (typed.length >= 42) {
      const recipient = checkRecipient(typed, { owner: state.address, asset: asset() });
      if (recipient.error) toNote.append(errorBox(recipient.error));
      else {
        const match = impersonates(recipient.address, paid);
        if (match)
          toNote.append(
            h(
              "p",
              { class: "error", role: "alert" },
              `This starts and ends like ${match.address}, an address you've paid before, but it's a different address. Lookalike addresses are a common scam.`,
            ),
          );
        else if (recipient.self)
          toNote.append(h("p", { class: "note" }, "That's your own address."));
      }
    }
    // The amount in dollars.
    const row = asset();
    const units = toUnits(amount.value, row.decimals);
    const dollars = units.error
      ? null
      : dollarsForTokens(units.units, wallet!.prices[row.symbol], row.decimals);
    amountNote.textContent = dollars ? `≈ $${dollars}` : "";
  };

  const max = h(
    "button",
    {
      class: "small",
      type: "button",
      onclick: () => {
        const row = asset();
        if (row.balance === null) return;
        const native = row.address === NATIVE;
        // ETH keeps back what the fee could cost (core/max-amount.js).
        const reserve = feeReserve(25_200, wallet!.maxFeePerGas ?? 0);
        amount.value = plainUnits(
          BigInt(maxSendable({ balance: row.balance, native, reserve })),
          row.decimals,
        );
        check();
      },
    },
    "Max",
  );
  select.addEventListener("change", check);
  to.addEventListener("input", check);
  amount.addEventListener("input", check);

  const form = h(
    "form",
    {
      class: "card",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        status.replaceChildren();
        const row = asset();
        const recipient = checkRecipient(to.value, { owner: state.address, asset: row });
        // A full-length address's problem is already shown under the field.
        if (recipient.error)
          return to.value.trim().length >= 42
            ? undefined
            : status.append(errorBox(recipient.error));
        const units = toUnits(amount.value, row.decimals);
        if (units.error) return status.append(errorBox(units.error));
        const short = checkAmount({
          units: units.units,
          balance: row.balance,
          symbol: row.symbol,
          decimals: row.decimals,
        });
        if (short) return status.append(errorBox(short));
        review.disabled = true;
        review.textContent = "Checking…";
        const answer = await ask({
          type: "wallet:send",
          asset: row.address,
          to: to.value.trim(),
          amount: amount.value.trim(),
        });
        review.disabled = false;
        review.textContent = "Review";
        if (answer?.error) return status.append(errorBox(answer.error));
        draft = {};
        view = "home";
        await remember();
        status.append(
          h("p", { class: "note" }, "Review and confirm it in the Tera window that just opened."),
        );
      },
    },
    h("label", {}, "Asset", select),
    h("label", {}, "To", to),
    toNote,
    h(
      "label",
      {},
      h("span", { class: "row" }, h("span", { class: "grow" }, "Amount"), max),
      amount,
    ),
    amountNote,
    status,
    review,
  );
  queueMicrotask(check);
  return [
    back,
    h("h1", {}, "Send"),
    form,
    h(
      "p",
      { class: "muted small" },
      "Robinhood Chain only. You'll see exactly what's sent, and the fee, before you confirm with your password.",
    ),
  ];
}

// ------------------------------------------------------------- receive ----

/** The address as a QR code, drawn as one SVG path: no markup is parsed. */
function qrCode(text: string) {
  const NS = "http://www.w3.org/2000/svg";
  const cells = encodeQR(text, "raw", { ecc: "medium", border: 2 });
  const size = cells.length;
  let d = "";
  cells.forEach((line, y) =>
    line.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `QR code for ${text}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", String(size));
  bg.setAttribute("height", String(size));
  bg.setAttribute("fill", "#fff");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.append(bg, path);
  return svg;
}

function receiveView() {
  const address = state.address!;
  return [
    h("button", { class: "link", type: "button", onclick: () => go("home") }, "← Back"),
    h("h1", {}, "Receive"),
    h(
      "section",
      { class: "card center" },
      qrCode(address),
      h("span", { class: "mono" }, address),
      copyButton(address),
    ),
    h(
      "p",
      { class: "note" },
      "Only send assets on Robinhood Chain to this address. The same address on another network is a different account Tera doesn't show.",
    ),
  ];
}

// ------------------------------------------------------------ activity ----

const STATUS: Record<string, string> = {
  broadcasting: "Sending",
  pending: "Pending",
  confirmed: "Confirmed",
  failed: "Failed",
  unknown: "Not confirmed: check before retrying",
  dropped: "Dropped: never confirmed",
};

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function activityView() {
  const sent = state.transactions.length
    ? h(
        "ul",
        { class: "signed" },
        ...state.transactions.map((entry) =>
          h(
            "li",
            {},
            h(
              "a",
              {
                class: "tx",
                href: `https://robinhoodchain.blockscout.com/tx/${entry.hash}`,
                target: "_blank",
                rel: "noreferrer",
              },
              h("span", { class: "title" }, entry.title),
              h(
                "span",
                { class: `muted small status-${entry.status}` },
                `${STATUS[entry.status] ?? entry.status} · ${originLabel(entry.site)} · ${when(entry.at)}`,
              ),
            ),
          ),
        ),
      )
    : h("p", { class: "muted small" }, "Nothing sent from this browser yet.");
  const signed = state.signatures.length
    ? h(
        "ul",
        { class: "signed" },
        ...state.signatures.map((entry) =>
          h(
            "li",
            {},
            h(
              "details",
              {},
              h(
                "summary",
                {},
                h("span", { class: "title" }, entry.title),
                h(
                  "span",
                  { class: "muted small" },
                  `${originLabel(entry.site)} · ${when(entry.at)}`,
                ),
              ),
              h("pre", { class: "message" }, entry.text),
              h("span", { class: "mono muted small" }, `Signature ${entry.signature}`),
            ),
          ),
        ),
      )
    : h(
        "p",
        { class: "muted small" },
        "Nothing signed yet. Every signature you approve is listed here, on this computer only.",
      );
  return [
    h("section", { class: "card" }, h("strong", {}, "Recent transactions"), sent),
    h("section", { class: "card" }, h("strong", {}, "Recent signatures"), signed),
  ];
}

// ------------------------------------------------------------ settings ----

function settingsView() {
  const { sites } = state;
  const list = sites.length
    ? h(
        "ul",
        { class: "sites" },
        ...sites.map((site) =>
          h(
            "li",
            {},
            h("span", { class: "origin", title: site.origin }, originLabel(site.origin)),
            h(
              "button",
              {
                class: "small",
                type: "button",
                onclick: async () => {
                  await ask({ type: "site:disconnect", origin: site.origin });
                  render();
                },
              },
              "Disconnect",
            ),
          ),
        ),
      )
    : h(
        "p",
        { class: "muted small" },
        "No sites connected. When a site asks, Tera opens a window so you can decide.",
      );
  return [
    h(
      "section",
      { class: "card" },
      h("strong", {}, `Connected sites${sites.length ? ` (${sites.length})` : ""}`),
      list,
    ),
    h(
      "p",
      { class: "note" },
      "Tera never stays unlocked: every transaction and signature asks for your password, and the key is opened only for that one step.",
    ),
    removeSection(state.address!),
    h(
      "p",
      { class: "muted small" },
      `Tera Wallet ${chrome.runtime.getManifest().version} for Robinhood Chain`,
    ),
  ];
}

function removeSection(address: string) {
  const box = h("div");
  const open = h(
    "button",
    {
      class: "link",
      type: "button",
      onclick: () => {
        const password = h("input", {
          type: "password",
          autocomplete: "current-password",
        }) as HTMLInputElement;
        const status = h("div");
        box.replaceChildren(
          h(
            "form",
            {
              class: "card",
              onsubmit: async (event: Event) => {
                event.preventDefault();
                const answer = await ask({ type: "wallet:remove", password: password.value });
                if (answer?.error) return status.replaceChildren(errorBox(answer.error));
                view = "home";
                draft = {};
                await remember();
                render();
              },
            },
            h(
              "p",
              { class: "small" },
              `Removes ${short(address)} and every site connection from this browser. Your funds stay on chain; your recovery phrase brings them back anywhere.`,
            ),
            h("label", {}, "Password", password),
            status,
            h(
              "div",
              { class: "actions" },
              h("button", { type: "button", onclick: () => box.replaceChildren(open) }, "Cancel"),
              h("button", { class: "primary", type: "submit" }, "Remove"),
            ),
          ),
        );
        password.focus();
      },
    },
    "Remove wallet from this browser",
  );
  box.append(open);
  return box;
}

void restore().then(render);
