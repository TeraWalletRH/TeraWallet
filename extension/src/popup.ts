// The toolbar popup: the wallet's address, the sites it's connected to (each
// with Disconnect), and bringing a wallet in or taking it out.

import { ask, errorBox, h, header, setupForm, short } from "./ui";

const root = document.getElementById("root")!;

type State = { address: string | null; sites: { origin: string; connectedAt: number }[] };

async function render() {
  const state = await ask<State>({ type: "state" });
  root.replaceChildren(header(), ...(state.address ? wallet(state) : [setupForm(render)]));
}

function wallet({ address, sites }: State) {
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
            h(
              "span",
              { class: "origin", title: site.origin },
              site.origin.replace(/^https:\/\//, ""),
            ),
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
    h(
      "p",
      { class: "note" },
      "This version connects to sites and shares your address only. Approving transactions and signatures comes in the next update.",
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
