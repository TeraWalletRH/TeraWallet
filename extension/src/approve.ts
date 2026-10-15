// The window that opens when a site asks to connect. The owner sees which
// site is asking and exactly what it gets, and approves with their password.

import { ask, errorBox, h, header, setupForm, short } from "./ui";

const root = document.getElementById("root")!;
const id = new URLSearchParams(location.search).get("id") || "";

// The background worker sleeps when idle; while the owner decides, this
// keeps it awake so the site's request isn't dropped.
setInterval(() => void ask({ type: "ping" }), 20_000);

async function render() {
  const approval = await ask<{ expired?: boolean; origin?: string; address?: string | null }>({
    type: "approval:get",
    id,
  });
  if (approval.expired) {
    root.replaceChildren(
      header(),
      h("h1", {}, "This request expired"),
      h("p", { class: "muted" }, "Go back to the site and connect again."),
      h("button", { class: "primary", onclick: () => window.close() }, "Close"),
    );
    return;
  }
  if (!approval.address) {
    root.replaceChildren(header(), setupForm(render));
    return;
  }
  const origin = approval.origin!;
  const password = h("input", {
    type: "password",
    autocomplete: "current-password",
  }) as HTMLInputElement;
  const status = h("div");
  const connect = h("button", { class: "primary", type: "submit" }, "Connect") as HTMLButtonElement;
  const local = origin.startsWith("http://");

  const parts: (HTMLElement | null)[] = [
    header(),
    h("h1", {}, "Connect to this site?"),
    h("section", { class: "card" }, h("span", { class: "site" }, origin)),
    local
      ? h(
          "p",
          { class: "note" },
          "This is a site running on your own computer. Only connect if you're building it.",
        )
      : null,
    h(
      "section",
      { class: "card" },
      h("strong", {}, "It will be able to"),
      h(
        "ul",
        { class: "facts" },
        h("li", {}, "See your address ", h("span", { class: "mono" }, short(approval.address))),
        h("li", {}, "See your balances and activity on Robinhood Chain (public anyway)"),
        h("li", {}, "Ask you to approve transactions later. Nothing moves without your OK."),
      ),
      h("strong", {}, "It won't be able to"),
      h("ul", { class: "facts" }, h("li", {}, "Move funds or sign anything on its own")),
    ),
    h(
      "form",
      {
        class: "card",
        onsubmit: async (event: Event) => {
          event.preventDefault();
          status.replaceChildren();
          connect.disabled = true;
          const answer = await ask({ type: "approval:connect", id, password: password.value });
          connect.disabled = false;
          if (answer?.expired) return render();
          if (answer?.error) {
            password.select();
            return status.append(errorBox(answer.error));
          }
          window.close();
        },
      },
      h("label", {}, "Password", password),
      status,
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          {
            type: "button",
            onclick: async () => {
              await ask({ type: "approval:reject", id });
              window.close();
            },
          },
          "Cancel",
        ),
        connect,
      ),
    ),
    h(
      "p",
      { class: "muted small" },
      "You can disconnect any time from the Tera button in the toolbar.",
    ),
  ];
  root.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null));
  password.focus();
}

render();
