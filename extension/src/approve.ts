// The window that opens when a site asks to connect or to sign. The owner
// sees which site is asking and exactly what it gets or what the signature
// does, in words, and approves with their password.

import { ask, errorBox, h, header, setupForm, short } from "./ui";
import { originLabel } from "./shared";

type SignRequest = {
  kind: "message" | "typed";
  address: string;
  danger: "low" | "unknown" | "high";
  title: string;
  warnings: string[];
  text?: string;
  readable?: boolean;
  typed?: unknown;
  explained?: { rows: [string, string][] };
};
type SendRequest = {
  tx: { from: string; to: string; value: string; data: string };
  described: {
    kind: string;
    danger: "low" | "unknown" | "high";
    title: string;
    rows: [string, string][];
    warnings: string[];
  };
  fee?: { maxFee: string };
  blocked?: string;
};
type Approval = {
  expired?: boolean;
  kind?: "connect" | "sign" | "send";
  origin?: string;
  address?: string | null;
  request?: SignRequest | SendRequest;
};

const root = document.getElementById("root")!;
const id = new URLSearchParams(location.search).get("id") || "";

// The background worker sleeps when idle; while the owner decides, this
// keeps it awake so the site's request isn't dropped.
setInterval(() => void ask({ type: "ping" }), 20_000);

async function render(notice?: string) {
  const approval = await ask<Approval>({ type: "approval:get", id });
  if (approval.expired) {
    root.replaceChildren(
      header(),
      h("h1", {}, "This request expired"),
      h("p", { class: "muted" }, "Go back to the site and try again."),
      h("button", { class: "primary", onclick: () => window.close() }, "Close"),
    );
    return;
  }
  if (!approval.address) {
    root.replaceChildren(header(), setupForm(render));
    return;
  }
  if (approval.kind === "send" && approval.request)
    return renderSend(approval.origin!, approval.request as SendRequest, notice);
  if (approval.kind === "sign" && approval.request)
    return renderSign(approval.origin!, approval.request as SignRequest);
  const origin = approval.origin!;
  const { form, password } = decide("Connect", "approval:connect");
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
        h(
          "li",
          {},
          "Ask you to sign messages and send transactions. Nothing happens without your OK.",
        ),
      ),
      h("strong", {}, "It won't be able to"),
      h("ul", { class: "facts" }, h("li", {}, "Move funds or sign anything on its own")),
    ),
    form,
    h(
      "p",
      { class: "muted small" },
      "You can disconnect any time from the Tera button in the toolbar.",
    ),
  ];
  root.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null));
  password.focus();
}

/** The password, Cancel and the action button, shared by both kinds of request. */
function decide(label: string, type: string, gate?: HTMLInputElement) {
  const password = h("input", {
    type: "password",
    autocomplete: "current-password",
  }) as HTMLInputElement;
  const status = h("div");
  const go = h("button", { class: "primary", type: "submit" }, label) as HTMLButtonElement;
  if (gate) {
    go.disabled = true;
    gate.addEventListener("change", () => (go.disabled = !gate.checked));
  }
  const form = h(
    "form",
    {
      class: "card",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        if (gate && !gate.checked) return;
        status.replaceChildren();
        go.disabled = true;
        const answer = await ask({ type, id, password: password.value });
        go.disabled = false;
        if (answer?.expired) return render();
        // The chain was read again and the numbers changed: shown afresh.
        if (answer?.refreshed) return render(answer.error);
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
      go,
    ),
  );
  return { form, password };
}

function renderSign(origin: string, request: SignRequest) {
  const tone =
    request.danger === "high"
      ? h(
          "p",
          { class: "danger", role: "alert" },
          request.kind === "typed" ? "Gives away spending power" : "This could be phishing",
        )
      : request.danger === "unknown"
        ? h("p", { class: "note" }, "Unknown. Don't sign unless you're sure.")
        : null;

  const content =
    request.kind === "message"
      ? h(
          "section",
          { class: "card" },
          h(
            "span",
            { class: "muted small" },
            request.readable ? "Message" : "Data (not readable text)",
          ),
          h("pre", { class: "message" }, request.text ?? ""),
        )
      : h(
          "section",
          { class: "card" },
          h(
            "dl",
            { class: "rows" },
            ...(request.explained?.rows ?? []).flatMap(([label, value]) => [
              h("dt", {}, label),
              h("dd", {}, value),
            ]),
          ),
          h(
            "details",
            {},
            h("summary", { class: "small" }, "Show the full request"),
            h("pre", { class: "message" }, JSON.stringify(request.typed, null, 2)),
          ),
        );

  const gate =
    request.danger === "low" ? undefined : (h("input", { type: "checkbox" }) as HTMLInputElement);
  const { form, password } = decide("Sign", "approval:sign", gate);

  const parts: (HTMLElement | null)[] = [
    header(),
    h("h1", {}, request.title),
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("span", { class: "muted small grow" }, "Asked by"),
        h("span", { class: "site" }, originLabel(origin)),
      ),
      h(
        "div",
        { class: "row" },
        h("span", { class: "muted small grow" }, "Signing as"),
        h("span", { class: "mono" }, short(request.address)),
      ),
    ),
    tone,
    request.warnings.length
      ? h("ul", { class: "warnings" }, ...request.warnings.map((w) => h("li", {}, w)))
      : null,
    content,
    request.danger === "low"
      ? h("p", { class: "muted small" }, "Signing is free and doesn't move funds by itself.")
      : null,
    gate
      ? h(
          "label",
          { class: "check" },
          gate,
          request.danger === "high"
            ? "I understand what this signature allows"
            : "I know what this is and want to sign it",
        )
      : null,
    form,
  ];
  root.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null));
  password.focus();
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function renderSend(origin: string, request: SendRequest, notice?: string) {
  const { described, fee, blocked, tx } = request;
  const tone =
    described.danger === "high"
      ? h(
          "p",
          { class: "danger", role: "alert" },
          ["approve", "approve-all", "approve-nft"].includes(described.kind)
            ? "Gives away spending power"
            : "High risk",
        )
      : described.danger === "unknown"
        ? h("p", { class: "note" }, "Tera can't fully read this. Don't confirm unless you're sure.")
        : null;
  const facts = h(
    "section",
    { class: "card" },
    h(
      "dl",
      { class: "rows" },
      ...described.rows.flatMap(([label, value]) => [
        h("dt", {}, label),
        h("dd", { class: ADDRESS.test(value) ? "mono" : "" }, value),
      ]),
      ...(fee ? [h("dt", {}, "Network fee"), h("dd", {}, `Up to ${fee.maxFee} ETH`)] : []),
    ),
    tx.data !== "0x"
      ? h(
          "details",
          {},
          h("summary", { class: "small" }, "Show the raw data"),
          h("pre", { class: "message" }, tx.data),
        )
      : null,
  );
  const head = [
    header(),
    h("h1", {}, described.title),
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("span", { class: "muted small grow" }, "Asked by"),
        h("span", { class: "site" }, originLabel(origin)),
      ),
      h(
        "div",
        { class: "row" },
        h("span", { class: "muted small grow" }, "From"),
        h("span", { class: "mono" }, short(tx.from)),
      ),
    ),
  ];
  if (notice) head.push(errorBox(notice));
  if (blocked) {
    root.replaceChildren(
      ...head,
      errorBox(blocked),
      facts,
      h(
        "button",
        {
          class: "primary",
          onclick: async () => {
            await ask({ type: "approval:reject", id });
            window.close();
          },
        },
        "Close",
      ),
    );
    return;
  }
  const gate =
    described.danger === "low" ? undefined : (h("input", { type: "checkbox" }) as HTMLInputElement);
  const { form, password } = decide("Confirm", "approval:send", gate);
  const parts: (HTMLElement | null)[] = [
    ...head,
    tone,
    described.warnings.length
      ? h("ul", { class: "warnings" }, ...described.warnings.map((w) => h("li", {}, w)))
      : null,
    facts,
    gate
      ? h(
          "label",
          { class: "check" },
          gate,
          described.danger === "high"
            ? "I understand what this transaction allows"
            : "I know what this is and want to send it",
        )
      : null,
    form,
  ];
  root.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null));
  password.focus();
}

render();
