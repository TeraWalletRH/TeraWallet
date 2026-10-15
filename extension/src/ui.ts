// What the popup and the approval window share: a tiny element builder, the
// call to the background worker, and the form that brings a wallet in.
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

/** Bringing a wallet into this browser. Calls `done` once it's sealed and stored. */
export function setupForm(done: () => void) {
  const secret = h("textarea", {
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "12 or 24 words, or a private key",
  }) as HTMLTextAreaElement;
  const password = h("input", {
    type: "password",
    autocomplete: "new-password",
  }) as HTMLInputElement;
  const repeat = h("input", { type: "password", autocomplete: "new-password" }) as HTMLInputElement;
  const status = h("div");
  const submit = h(
    "button",
    { class: "primary", type: "submit" },
    "Add wallet",
  ) as HTMLButtonElement;

  const form = h(
    "form",
    {
      class: "card",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        status.replaceChildren();
        if (password.value !== repeat.value)
          return status.append(errorBox("The passwords don't match."));
        submit.disabled = true;
        submit.textContent = "Sealing…";
        const answer = await ask({
          type: "wallet:add",
          secret: secret.value,
          password: password.value,
        });
        submit.disabled = false;
        submit.textContent = "Add wallet";
        if (answer?.error) return status.append(errorBox(answer.error));
        secret.value = "";
        done();
      },
    },
    h("label", {}, "Recovery phrase or private key", secret),
    h("label", {}, "Password for this browser (6+ characters)", password),
    h("label", {}, "Password again", repeat),
    status,
    submit,
  );
  return h(
    "div",
    { class: "stack" },
    h("h1", {}, "Bring your wallet to this browser"),
    h(
      "p",
      { class: "muted" },
      "Use the same recovery phrase as your Tera app. It's sealed with your password on this computer and never sent anywhere.",
    ),
    form,
  );
}
