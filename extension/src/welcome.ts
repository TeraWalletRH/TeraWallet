// Setting Tera up in this browser, in its own tab: Chrome closes the popup
// the moment it loses focus, which is every time someone switches to a
// password manager or the note their phrase is in, so the popup only points
// here. The rules (password strength, pasting a phrase) are in
// core/onboarding.js.
//
//   Welcome → Create a new wallet          → the Tera web wallet makes it
//           → I already have a wallet → Recovery phrase | Private key
//                                     → Create a password → You're all set
//
// The secret lives in this page's memory only between the step it's typed in
// and the password step, which hands it to the background worker to seal
// (wallet:add) and drops it. Going back to the start drops it too.

import { wordlist } from "@scure/bip39/wordlists/english";
import { walletFromSecret } from "../../android/src/crypto";
import {
  inviteHash,
  makeInvite,
  openSealed,
  sessionId,
  type Invite,
  type Sealed,
} from "../../android/src/handoff";
import {
  MIN_PASSWORD,
  PHRASE_LENGTHS,
  fillBoxes,
  passwordStrength,
  phraseWords,
} from "../../public/tera/core/onboarding.js";
import { ask, errorBox, h, short, themePicker } from "./ui";

/** Where a new wallet is made: the web wallet, which hands it back (android/src/handoff.ts). */
const CREATE_URL = `${__TERA_WEB__}/app`;
const TERMS_URL = "https://www.terawallet.app/legal/terms-of-service/";
const PRIVACY_URL = "https://www.terawallet.app/legal/privacy-policy/";

type Step =
  "welcome" | "create" | "import" | "phrase" | "key" | "watch" | "password" | "done" | "ready";

const root = document.getElementById("root")!;
const WORDS = new Set(wordlist);

let step: Step = "welcome";
let secret = "";
let kind: "phrase" | "key" = "phrase";
let address = "";
let boxes: string[] = Array(12).fill("");
let shown = false;
/** The step the password step goes back to. */
let from: Step = "phrase";
/** While a new wallet is being made in the web wallet: the invite and its key. */
let invite: Invite | null = null;
let inviteKey: CryptoKey | null = null;
let handoffError = "";
/** The wallet set up here is watch-only (vault.ts WatchVault). */
let watching = false;

function go(next: Step) {
  if (next === "welcome" || next === "import" || next === "create") secret = "";
  step = next;
  draw();
  root.querySelector<HTMLElement>("[data-focus]")?.focus();
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------- pieces ----

const mark = () =>
  h("div", { class: "mark" }, h("img", { src: "icons/icon-128.png", alt: "", width: 72 }));

/** The dots along the top: which of the three steps of bringing a wallet in this is. */
function progress(at: number) {
  return h(
    "ol",
    { class: "progress", "aria-label": `Step ${at} of 3` },
    ...[1, 2, 3].map((n) => h("li", { class: n < at ? "past" : n === at ? "now" : "" })),
  );
}

function topBar(back: Step | null, at?: number) {
  return h(
    "div",
    { class: "topbar" },
    back
      ? h(
          "button",
          { class: "back", type: "button", "aria-label": "Back", onclick: () => go(back) },
          "←",
        )
      : h("span"),
    at ? progress(at) : h("span"),
    h("span"),
  );
}

const panel = (...children: (Node | string | null | false)[]) =>
  h("section", { class: "panel" }, ...children);

/** One of the choices on the import page: an icon, a title and a line under it. */
const option = (icon: string, title: string, line: string, onclick: () => void) =>
  h(
    "button",
    { class: "option", type: "button", onclick },
    h("span", { class: "option-icon", "aria-hidden": "true" }, icon),
    h("span", { class: "option-text" }, h("strong", {}, title), h("span", {}, line)),
    h("span", { class: "chevron", "aria-hidden": "true" }, "›"),
  );

// -------------------------------------------------------------- steps ----

function welcome() {
  return panel(
    mark(),
    h("h1", { class: "hero" }, "Welcome to Tera"),
    h(
      "p",
      { class: "lede" },
      "The wallet for Robinhood Chain, in your browser. Hold, send and swap tokenized stocks and crypto, and connect to sites on your terms.",
    ),
    h(
      "div",
      { class: "choices" },
      h(
        "button",
        { class: "primary big", type: "button", onclick: () => go("create") },
        "Create a new wallet",
      ),
      h(
        "button",
        { class: "big", type: "button", onclick: () => go("import") },
        "I already have a wallet",
      ),
    ),
    h(
      "p",
      { class: "fine" },
      "By continuing you agree to Tera's ",
      h("a", { href: TERMS_URL, target: "_blank", rel: "noopener" }, "Terms"),
      " and ",
      h("a", { href: PRIVACY_URL, target: "_blank", rel: "noopener" }, "Privacy Policy"),
      ".",
    ),
  );
}

/**
 * A wallet arriving from the web wallet: opened with this tab's key, checked
 * to be a real phrase, and taken on to the password step.
 */
async function receive(sealed: unknown) {
  if (!invite || !inviteKey || !sealed) return;
  try {
    const phrase = await openSealed(sealed as Sealed, invite, inviteKey);
    address = walletFromSecret(phrase).address;
    secret = phrase;
    kind = "phrase";
    from = "create";
    invite = inviteKey = null;
    await chrome.storage.session.remove(["handoff", "handoffWaiting"]);
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    go("password");
  } catch (error) {
    await chrome.storage.session.remove("handoff");
    handoffError = (error as Error).message;
    draw();
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.handoff?.newValue) void receive(changes.handoff.newValue);
});
// The key goes with this tab; a wallet sent after it closes is refused.
addEventListener("pagehide", () => {
  if (invite) void chrome.storage.session.remove("handoffWaiting");
});

async function startCreate() {
  handoffError = "";
  const made = await makeInvite(chrome.runtime.id);
  invite = made.invite;
  inviteKey = made.privateKey;
  await chrome.storage.session.remove("handoff");
  await chrome.storage.session.set({ handoffWaiting: sessionId(invite) });
  await chrome.tabs.create({ url: `${CREATE_URL}${inviteHash(invite)}` });
  draw();
}

function create() {
  const waiting = Boolean(invite);
  return [
    topBar("welcome", 1),
    panel(
      h("div", { class: `glyph${waiting ? " spin" : ""}`, "aria-hidden": "true" }, "✦"),
      h("h1", {}, waiting ? "Waiting for your new wallet" : "Create a new wallet"),
      h(
        "p",
        { class: "lede" },
        waiting
          ? "Finish in the Tera tab: write down the 12 words, check them, then choose Send to Tera for Chrome. Keep this tab open."
          : "Tera opens its web wallet in a new tab, where you'll see your recovery phrase and back it up. Then the wallet comes straight back here.",
      ),
      waiting
        ? null
        : h(
            "ol",
            { class: "steps" },
            h("li", {}, "Write down the 12 words Tera shows you."),
            h("li", {}, "Check three of them, so you know your copy is right."),
            h("li", {}, "Send the wallet to Tera for Chrome and set a password here."),
          ),
      handoffError ? errorBox(handoffError) : null,
      h(
        "p",
        { class: "fine" },
        "The wallet comes back encrypted to a key only this tab holds. Tera's servers never see it, and the web wallet keeps nothing.",
      ),
      h(
        "div",
        { class: "choices" },
        h(
          "button",
          {
            class: "primary big",
            type: "button",
            onclick: () => void startCreate(),
          },
          waiting ? "Open the Tera tab again" : "Create my wallet",
        ),
      ),
    ),
  ];
}

function importChoice() {
  return [
    topBar("welcome", 1),
    panel(
      h("h1", {}, "Bring in your wallet"),
      h(
        "p",
        { class: "lede" },
        "Use the wallet you already have in the Tera app or any other wallet.",
      ),
      h(
        "div",
        { class: "options" },
        option("⌗", "Recovery phrase", "12 or 24 words", () => {
          kind = "phrase";
          from = "phrase";
          go("phrase");
        }),
        option("⚿", "Private key", "A 64-character key from one account", () => {
          kind = "key";
          from = "key";
          go("key");
        }),
        option("◉", "Watch an address", "See balances and activity, without a key", () =>
          go("watch"),
        ),
      ),
      h(
        "p",
        { class: "fine" },
        "Whatever you type stays on this computer, sealed with the password you pick next. Tera never sees it.",
      ),
    ),
  ];
}

function phrase() {
  const status = h("div", { class: "status" });
  const next = h(
    "button",
    { class: "primary big", type: "button", disabled: true },
    "Continue",
  ) as HTMLButtonElement;
  const grid = h("div", { class: "words" });

  const check = () => {
    const filled = boxes.every(Boolean);
    status.replaceChildren();
    next.disabled = true;
    if (!filled) return;
    try {
      address = walletFromSecret(boxes.join(" ")).address;
      status.append(
        h("p", { class: "found" }, "Wallet found · ", h("span", { class: "mono" }, short(address))),
      );
      next.disabled = false;
    } catch {
      status.append(
        errorBox(
          boxes.some((word) => !WORDS.has(word))
            ? "Some words aren't recovery phrase words. Check the ones in red."
            : "These words don't make a valid phrase. Check their order.",
        ),
      );
    }
  };

  const inputs = boxes.map((word, i) => {
    const input = h("input", {
      type: shown ? "text" : "password",
      value: word,
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      "aria-label": `Word ${i + 1}`,
      "data-focus": i === 0 ? "" : undefined,
    }) as HTMLInputElement;
    const flag = () =>
      input.classList.toggle("bad", Boolean(input.value) && !WORDS.has(input.value));
    flag();
    input.addEventListener("paste", (event) => {
      const text = (event as ClipboardEvent).clipboardData?.getData("text") ?? "";
      if (phraseWords(text).length < 2) return;
      event.preventDefault();
      const before = boxes.length;
      boxes = fillBoxes(boxes, i, text);
      if (boxes.length !== before) return go("phrase");
      boxes.forEach((value, j) => {
        inputs[j].value = value;
        inputs[j].dispatchEvent(new Event("blur"));
      });
      check();
    });
    input.addEventListener("input", () => {
      const words = phraseWords(input.value);
      // A space moves on to the next box, as typing a phrase out naturally does.
      if (/\s$/.test(input.value) && words.length === 1) {
        input.value = words[0];
        boxes[i] = words[0];
        inputs[i + 1]?.focus();
      } else boxes[i] = words[0] ?? "";
      input.classList.remove("bad");
      check();
    });
    input.addEventListener("blur", flag);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !next.disabled) next.click();
      if (event.key === "Backspace" && !input.value && i > 0) inputs[i - 1].focus();
    });
    grid.append(h("label", { class: "word" }, h("span", {}, String(i + 1)), input));
    return input;
  });

  next.addEventListener("click", () => {
    secret = boxes.join(" ");
    go("password");
  });
  check();

  return [
    topBar("import", 2),
    panel(
      h("h1", {}, "Enter your recovery phrase"),
      h(
        "p",
        { class: "lede" },
        "Type the words in order, or paste the whole phrase into the first box.",
      ),
      h(
        "div",
        { class: "row between" },
        h(
          "div",
          { class: "segmented", role: "group", "aria-label": "Phrase length" },
          ...PHRASE_LENGTHS.map((n) =>
            h(
              "button",
              {
                type: "button",
                class: boxes.length === n ? "on" : "",
                "aria-pressed": String(boxes.length === n),
                onclick: () => {
                  boxes = Array.from({ length: n }, (_, i) => boxes[i] ?? "");
                  go("phrase");
                },
              },
              `${n} words`,
            ),
          ),
        ),
        h(
          "button",
          {
            class: "link",
            type: "button",
            onclick: (event: Event) => {
              shown = !shown;
              for (const input of inputs) input.type = shown ? "text" : "password";
              (event.target as HTMLElement).textContent = shown ? "Hide words" : "Show words";
            },
          },
          shown ? "Hide words" : "Show words",
        ),
      ),
      grid,
      status,
      next,
    ),
  ];
}

function key() {
  const status = h("div", { class: "status" });
  const next = h(
    "button",
    { class: "primary big", type: "button", disabled: true },
    "Continue",
  ) as HTMLButtonElement;
  const field = h("input", {
    type: "password",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "0x…",
    class: "mono",
    "data-focus": "",
  }) as HTMLInputElement;
  field.addEventListener("input", () => {
    status.replaceChildren();
    next.disabled = true;
    const text = field.value.trim();
    if (!text) return;
    try {
      if (/\s/.test(text)) throw new Error();
      address = walletFromSecret(text).address;
      status.append(
        h("p", { class: "found" }, "Wallet found · ", h("span", { class: "mono" }, short(address))),
      );
      next.disabled = false;
    } catch {
      if (text.replace(/^0x/i, "").length >= 64)
        status.append(
          errorBox("That isn't a private key. It's 64 letters and numbers, 0–9 and a–f."),
        );
    }
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !next.disabled) next.click();
  });
  next.addEventListener("click", () => {
    secret = field.value.trim();
    field.value = "";
    go("password");
  });
  return [
    topBar("import", 2),
    panel(
      h("h1", {}, "Enter your private key"),
      h(
        "p",
        { class: "lede" },
        "A private key brings in one account. With a recovery phrase you get every account the phrase holds.",
      ),
      h(
        "div",
        { class: "reveal" },
        field,
        h(
          "button",
          {
            class: "link",
            type: "button",
            onclick: (event: Event) => {
              field.type = field.type === "password" ? "text" : "password";
              (event.target as HTMLElement).textContent =
                field.type === "password" ? "Show" : "Hide";
            },
          },
          "Show",
        ),
      ),
      status,
      next,
    ),
  ];
}

function watch() {
  const status = h("div", { class: "status" });
  const next = h(
    "button",
    { class: "primary big", type: "button", disabled: true },
    "Watch this wallet",
  ) as HTMLButtonElement;
  const field = h("input", {
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "0x…",
    class: "mono",
    "data-focus": "",
  }) as HTMLInputElement;
  const valid = () =>
    /^0x[0-9a-fA-F]{40}$/.test(field.value.trim()) && !/^0x0{40}$/i.test(field.value.trim());
  field.addEventListener("input", () => {
    status.replaceChildren();
    next.disabled = !valid();
    const text = field.value.trim();
    if (text.length >= 42 && !valid())
      status.append(errorBox("That isn't a wallet address. It's 0x and 40 letters and numbers."));
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !next.disabled) next.click();
  });
  next.addEventListener("click", async () => {
    next.disabled = true;
    const answer = await ask({ type: "wallet:watch", address: field.value.trim() });
    if (answer?.error) {
      next.disabled = false;
      return status.replaceChildren(errorBox(answer.error));
    }
    address = answer.address;
    watching = true;
    go("done");
  });
  return [
    topBar("import", 2),
    panel(
      h("div", { class: "glyph", "aria-hidden": "true" }, "◉"),
      h("h1", {}, "Watch an address"),
      h(
        "p",
        { class: "lede" },
        "Follow any wallet's balances and activity, and connect it to sites to look around. With no key, Tera can't send, swap or sign for it, so there's no password to set.",
      ),
      field,
      status,
      next,
    ),
  ];
}

function password() {
  if (!secret) {
    queueMicrotask(() => go("import"));
    return [];
  }
  const first = h("input", {
    type: "password",
    autocomplete: "new-password",
    "data-focus": "",
  }) as HTMLInputElement;
  const again = h("input", { type: "password", autocomplete: "new-password" }) as HTMLInputElement;
  const meter = h("div", { class: "meter", "data-score": "0" }, h("i"), h("i"), h("i"), h("i"));
  const label = h("span", { class: "meter-label" }, `At least ${MIN_PASSWORD} characters`);
  const status = h("div", { class: "status" });
  const submit = h(
    "button",
    { class: "primary big", type: "submit", disabled: true },
    "Continue",
  ) as HTMLButtonElement;

  const update = () => {
    const strength = passwordStrength(first.value);
    meter.dataset.score = String(first.value ? strength.score : 0);
    label.textContent = first.value ? strength.label : `At least ${MIN_PASSWORD} characters`;
    const matches = again.value === first.value;
    again.classList.toggle(
      "bad",
      Boolean(again.value) && !matches && again.value.length >= first.value.length,
    );
    submit.disabled = !strength.ok || !matches;
  };
  first.addEventListener("input", update);
  again.addEventListener("input", update);

  return [
    topBar(from, 3),
    panel(
      h("div", { class: "glyph", "aria-hidden": "true" }, "⚷"),
      h("h1", {}, "Create a password"),
      h(
        "p",
        { class: "lede" },
        `It unlocks Tera on this computer, and every send and signature asks for it. Tera can't reset it, but your ${kind === "key" ? "private key" : "recovery phrase"} can always bring the wallet back.`,
      ),
      from === "create"
        ? h(
            "p",
            { class: "found" },
            "Your new wallet is here · ",
            h("span", { class: "mono" }, short(address)),
          )
        : null,
      h(
        "form",
        {
          class: "fields",
          onsubmit: async (event: Event) => {
            event.preventDefault();
            status.replaceChildren();
            submit.disabled = true;
            submit.textContent = "Sealing your wallet…";
            const answer = await ask({ type: "wallet:add", secret, password: first.value });
            if (answer?.error) {
              submit.disabled = false;
              submit.textContent = "Continue";
              return status.append(errorBox(answer.error));
            }
            secret = "";
            first.value = again.value = "";
            address = answer.address;
            go("done");
          },
        },
        h("label", {}, "Password", first, h("span", { class: "strength" }, meter, label)),
        h("label", {}, "Confirm password", again),
        status,
        submit,
      ),
    ),
  ];
}

/** Whether Tera is pinned to the toolbar, where Chrome lets an extension ask (116+ always does). */
async function pinned() {
  try {
    return (await chrome.action.getUserSettings()).isOnToolbar;
  } catch {
    return null;
  }
}

async function openTera() {
  try {
    await chrome.action.openPopup();
  } catch {
    // Older Chrome only opens the popup from the toolbar itself.
  }
}

function done(again = false) {
  const pin = h("div", { class: "pin" });
  const drawPin = (on: boolean | null) =>
    pin.replaceChildren(
      on
        ? h("p", { class: "pinned" }, "✓ Tera is pinned to your toolbar")
        : h(
            "div",
            {},
            h("strong", {}, "Pin Tera to your toolbar"),
            h(
              "p",
              { class: "muted" },
              "Click the puzzle piece in Chrome's toolbar, then the pin next to Tera Wallet. Tera is one click away after that.",
            ),
            h(
              "div",
              { class: "pin-art", "aria-hidden": "true" },
              h("span", {}, "🧩"),
              h("span", {}, "→"),
              h("span", {}, "📌"),
            ),
          ),
    );
  drawPin(null);
  const poll = async () => {
    if (step !== "done" && step !== "ready") return;
    const on = await pinned();
    drawPin(on);
    if (!on) setTimeout(poll, 1000);
  };
  void poll();

  return panel(
    h("div", { class: "glyph ok", "aria-hidden": "true" }, "✓"),
    h("h1", { class: "hero" }, again ? "Tera is already set up" : "You're all set"),
    h(
      "p",
      { class: "lede" },
      again
        ? "This browser has a wallet: "
        : watching
          ? "Tera is watching "
          : "Your wallet is ready in this browser: ",
      h("span", { class: "mono", title: address }, short(address)),
    ),
    pin,
    h("div", { class: "look" }, h("strong", {}, "Pick a look"), themePicker()),
    h(
      "div",
      { class: "choices" },
      h("button", { class: "primary big", type: "button", onclick: openTera }, "Open Tera"),
      h(
        "button",
        { class: "big", type: "button", onclick: () => window.close() },
        "Close this tab",
      ),
    ),
  );
}

// -------------------------------------------------------------- render ----

function draw() {
  const body =
    step === "create"
      ? create()
      : step === "import"
        ? importChoice()
        : step === "phrase"
          ? phrase()
          : step === "key"
            ? key()
            : step === "watch"
              ? watch()
              : step === "password"
                ? password()
                : step === "done"
                  ? done()
                  : step === "ready"
                    ? done(true)
                    : welcome();
  root.replaceChildren(...(Array.isArray(body) ? body : [body]));
}

async function start() {
  const state = await ask<{ address: string | null }>({ type: "state" });
  if (state?.address) {
    address = state.address;
    step = "ready";
  } else {
    const wanted = new URLSearchParams(location.search).get("start");
    if (wanted === "create" || wanted === "import") step = wanted;
  }
  draw();
  root.querySelector<HTMLElement>("[data-focus]")?.focus();
}

void start();
