// The toolbar popup: the wallet's address, the sites it's connected to (each
// with Disconnect), the messages it has signed, and bringing a wallet in or
// taking it out.

import { ask, errorBox, h, header, setupForm, short } from "./ui";

const root = document.getElementById("root")!;

type Signed = { at: number; title: string; site: string; text: string; signature: string };
type State = {
  address: string | null;
  sites: { origin: string; connectedAt: number }[];
  signatures: Signed[];
  transactions: Sent[];
};
type Sent = { hash: string; at: number; site: string; title: string; status: string };

const STATUS: Record<string, string> = {
  broadcasting: "Sending",
  pending: "Pending",
  confirmed: "Confirmed",
  failed: "Failed",
  unknown: "Not confirmed: check before retrying",
};

function sentList(transactions: Sent[]) {
  if (!transactions.length)
    return h("p", { class: "muted small" }, "Nothing sent from this browser yet.");
  return h(
    "ul",
    { class: "signed" },
    ...transactions.map((sent) =>
      h(
        "li",
        {},
        h(
          "a",
          {
            class: "tx",
            href: `https://robinhoodchain.blockscout.com/tx/${sent.hash}`,
            target: "_blank",
            rel: "noreferrer",
          },
          h("span", { class: "title" }, sent.title),
          h(
            "span",
            { class: `muted small status-${sent.status}` },
            `${STATUS[sent.status] ?? sent.status} · ${host(sent.site)} · ${when(sent.at)}`,
          ),
        ),
      ),
    ),
  );
}

const host = (origin: string) => origin.replace(/^https:\/\//, "");
const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function signedList(signatures: Signed[]) {
  if (!signatures.length)
    return h(
      "p",
      { class: "muted small" },
      "Nothing signed yet. Every signature you approve is listed here, on this computer only.",
    );
  return h(
    "ul",
    { class: "signed" },
    ...signatures.map((entry) =>
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
            h("span", { class: "muted small" }, `${host(entry.site)} · ${when(entry.at)}`),
          ),
          h("pre", { class: "message" }, entry.text),
          h("span", { class: "mono muted small" }, `Signature ${entry.signature}`),
        ),
      ),
    ),
  );
}

async function render() {
  const state = await ask<State>({ type: "state" });
  root.replaceChildren(header(), ...(state.address ? wallet(state) : [setupForm(render)]));
}

function wallet({ address, sites, signatures, transactions }: State) {
  const copy = h("button", { class: "small", type: "button" }, "Copy") as HTMLButtonElement;
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(address!);
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy"), 1500);
  });

  const list = sites.length
    ? h(
        "ul",
        { class: "sites" },
        ...sites.map((site) =>
          h(
            "li",
            {},
            h("span", { class: "origin", title: site.origin }, host(site.origin)),
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
      h("div", { class: "row" }, h("span", { class: "muted small grow" }, "Your address"), copy),
      h("span", { class: "mono", title: address! }, address!),
    ),
    h(
      "section",
      { class: "card" },
      h("strong", {}, `Connected sites${sites.length ? ` (${sites.length})` : ""}`),
      list,
    ),
    h("section", { class: "card" }, h("strong", {}, "Recent transactions"), sentList(transactions)),
    h("section", { class: "card" }, h("strong", {}, "Recent signatures"), signedList(signatures)),
    h(
      "p",
      { class: "note" },
      "Every transaction and signature needs your password. Nothing is sent without your OK.",
    ),
    removeSection(address!),
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

render();
