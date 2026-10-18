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
import {
  SLIPPAGE_CHOICES,
  DEFAULT_SLIPPAGE_BPS,
  slippageLabel,
} from "../../public/tera/core/slippage.js";
import { FIXED_TERMS, fixedReward } from "../../public/tera/core/staking.js";
import { swapPair, tradable } from "../../public/tera/core/wallet-swap.js";
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
type Asset = { symbol: string; name: string; address: string; decimals: number; priceAs?: string };
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
type View = "home" | "send" | "receive" | "swap" | "stake" | "activity" | "settings";
type Draft = { asset?: string; to?: string; amount?: string };
type SwapDraft = { asset?: string; side?: "BUY" | "SELL"; amount?: string; slippageBps?: number };
type Staking = {
  error?: string;
  positions: {
    epoch_id: string;
    active_stake: string;
    claimable_rewards?: string;
    is_locked?: boolean;
    lock_tier?: string;
    remaining_lock_seconds?: number;
  }[];
  locks: {
    id: string;
    term_days: number;
    principal_amount: string;
    reward_amount: string;
    unlocks_at: string;
    status: string;
    isMatured: boolean;
  }[];
  payouts: {
    kind: string;
    principal_amount: string;
    reward_amount: string;
    status: string;
    created_at: string;
  }[];
  epoch: { ends_at: string } | null;
  flexibleApr: number | null;
  configured: boolean;
  balance: string | null;
  pending: { kind: string; termDays?: number; amount: string; txHash: string; at: number }[];
};

let state: State;
let wallet: Balances | null = null;
let view: View = "home";
let draft: Draft = {};
let swapDraft: SwapDraft = {};
let stakeState: Staking | null = null;

// ------------------------------------------------------------- session ----

async function restore() {
  try {
    const saved = await chrome.storage.session.get(["view", "draft", "swapDraft"]);
    if (saved.swapDraft && typeof saved.swapDraft === "object")
      swapDraft = saved.swapDraft as SwapDraft;
    if (typeof saved.view === "string") view = saved.view as View;
    if (saved.draft && typeof saved.draft === "object") draft = saved.draft as Draft;
  } catch {
    // No session storage: start on Home.
  }
}
const remember = () => chrome.storage.session.set({ view, draft, swapDraft }).catch(() => {});

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
  if (view === "home" || view === "send" || view === "swap") draw();
}

/** Balances again, after something was sent or on coming back to the wallet. */
async function refreshWallet() {
  wallet = await ask<Balances>({ type: "wallet:balances" });
  if (view === "home" || view === "send" || view === "swap") draw();
}

async function loadStaking() {
  stakeState = await ask<Staking>({ type: "wallet:staking" });
  if (view === "stake") draw();
}

function draw() {
  const body =
    view === "send"
      ? sendView()
      : view === "swap"
        ? swapView()
        : view === "stake"
          ? stakeView()
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
          view === name || (name === "home" && ["send", "receive", "swap", "stake"].includes(view))
            ? "on"
            : "",
        "aria-current": view === name ? "page" : undefined,
        onclick: () => {
          go(name);
          if (name === "home") void refreshWallet();
        },
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
    list.map((row) => ({ symbol: row.priceAs ?? row.symbol, amount: row.amount ?? "" })),
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
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", onclick: () => go("swap") }, "Swap"),
        h(
          "button",
          {
            type: "button",
            onclick: () => {
              stakeState = null;
              go("stake");
            },
          },
          "Stake",
        ),
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
      : dollarsForTokens(units.units, wallet!.prices[row.priceAs ?? row.symbol], row.decimals);
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
        void refreshWallet();
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

// ---------------------------------------------------------------- swap ----

function swapView() {
  const back = h("button", { class: "link", type: "button", onclick: () => go("home") }, "← Back");
  if (!wallet) return [back, h("p", { class: "muted" }, "Reading your balances…")];
  if (wallet.error) return [back, errorBox(wallet.error)];
  const choices = tradable(wallet.assets) as Asset[];
  if (!choices.length)
    return [back, errorBox("Tera's asset list couldn't be read. Try again shortly.")];

  let side: "BUY" | "SELL" = swapDraft.side === "SELL" ? "SELL" : "BUY";
  const select = h(
    "select",
    { "aria-label": "Asset" },
    ...choices.map((asset) =>
      h("option", { value: asset.address }, `${asset.symbol} · ${asset.name}`),
    ),
  ) as HTMLSelectElement;
  select.value = choices.some((a) => a.address === swapDraft.asset)
    ? swapDraft.asset!
    : choices[0].address;
  const amount = h("input", {
    inputmode: "decimal",
    autocomplete: "off",
    placeholder: "0.0",
    value: swapDraft.amount ?? "",
  }) as HTMLInputElement;
  const slippage = h(
    "select",
    { "aria-label": "Slippage limit" },
    ...SLIPPAGE_CHOICES.map((bps: number) =>
      h("option", { value: String(bps) }, slippageLabel(bps)),
    ),
  ) as HTMLSelectElement;
  slippage.value = String(swapDraft.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
  const payLabel = h("span", { class: "grow" });
  const have = h("span", { class: "muted small" });
  const estimate = h("span", { class: "muted small" });
  const status = h("div");
  const review = h(
    "button",
    { class: "primary", type: "submit" },
    "Get a quote",
  ) as HTMLButtonElement;
  const buy = h("button", { type: "button" }, "Buy") as HTMLButtonElement;
  const sell = h("button", { type: "button" }, "Sell") as HTMLButtonElement;

  const pair = () =>
    swapPair(
      choices.find((a) => a.address === select.value),
      side,
      wallet!.assets,
    );
  const balanceOf = (asset: Asset) => wallet!.balances[asset.address] ?? null;
  const update = () => {
    swapDraft = {
      asset: select.value,
      side,
      amount: amount.value,
      slippageBps: Number(slippage.value),
    };
    void remember();
    buy.className = side === "BUY" ? "on" : "";
    sell.className = side === "SELL" ? "on" : "";
    const p = pair();
    if (!p) return;
    payLabel.textContent = `You pay (${p.pay.symbol})`;
    const held = balanceOf(p.pay);
    have.textContent =
      held === null
        ? "Balance unknown"
        : `You have ${formatUnits(held, p.pay.decimals)} ${p.pay.symbol}`;
    const typed = toUnits(amount.value, p.pay.decimals);
    const payPrice = Number(wallet!.prices[p.pay.priceAs ?? p.pay.symbol]);
    const getPrice = Number(wallet!.prices[p.receive.priceAs ?? p.receive.symbol]);
    estimate.textContent =
      !typed.error && payPrice > 0 && getPrice > 0
        ? `≈ ${(((Number(typed.units) / 10 ** p.pay.decimals) * payPrice) / getPrice).toPrecision(6)} ${p.receive.symbol} at today's prices, before the quote`
        : "";
  };
  buy.addEventListener("click", () => ((side = "BUY"), update()));
  sell.addEventListener("click", () => ((side = "SELL"), update()));
  select.addEventListener("change", update);
  amount.addEventListener("input", update);
  slippage.addEventListener("change", update);
  const max = h(
    "button",
    {
      class: "small",
      type: "button",
      onclick: () => {
        const p = pair();
        const held = p && balanceOf(p.pay);
        if (!p || held === null || held === undefined) return;
        const reserve = feeReserve(25_200 * 3, wallet!.maxFeePerGas ?? 0);
        amount.value = plainUnits(
          BigInt(maxSendable({ balance: held, native: p.pay.address === NATIVE, reserve })),
          p.pay.decimals,
        );
        update();
      },
    },
    "Max",
  );

  const form = h(
    "form",
    {
      class: "card",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        status.replaceChildren();
        const p = pair();
        if (!p) return status.append(errorBox("This swap isn't offered."));
        const typed = toUnits(amount.value, p.pay.decimals);
        if (typed.error) return status.append(errorBox(typed.error));
        const short = checkAmount({
          units: typed.units,
          balance: balanceOf(p.pay),
          symbol: p.pay.symbol,
          decimals: p.pay.decimals,
        });
        if (short) return status.append(errorBox(short));
        review.disabled = true;
        review.textContent = "Getting a quote…";
        const answer = await ask({
          type: "wallet:swap",
          asset: select.value,
          side,
          amount: amount.value.trim(),
          slippageBps: Number(slippage.value),
        });
        review.disabled = false;
        review.textContent = "Get a quote";
        if (answer?.error) return status.append(errorBox(answer.error));
        swapDraft = { asset: select.value, side, slippageBps: Number(slippage.value) };
        view = "home";
        await remember();
        void refreshWallet();
        status.append(
          h(
            "p",
            { class: "note" },
            "Review and confirm the swap in the Tera window that just opened.",
          ),
        );
      },
    },
    h("div", { class: "seg" }, buy, sell),
    h("label", {}, "Asset", select),
    h("label", {}, h("span", { class: "row" }, payLabel, max), amount),
    have,
    estimate,
    h("label", {}, "Slippage limit", slippage),
    status,
    review,
  );
  queueMicrotask(update);
  return [
    back,
    h("h1", {}, "Swap"),
    form,
    h(
      "p",
      { class: "muted small" },
      "Tera trades each asset against USDG (TERA against ETH). The quote is checked on this computer, byte for byte, before you see it.",
    ),
  ];
}

// --------------------------------------------------------------- stake ----

const tera = (units: string | bigint) => `${formatUnits(units, 18)} TERA`;

function stakeView() {
  const back = h("button", { class: "link", type: "button", onclick: () => go("home") }, "← Back");
  if (!stakeState) {
    void loadStaking();
    return [back, h("h1", {}, "Stake TERA"), h("p", { class: "muted" }, "Reading your staking…")];
  }
  if (stakeState.error) return [back, h("h1", {}, "Stake TERA"), errorBox(stakeState.error)];
  const st = stakeState;
  const status = h("div");

  const request = async (body: Record<string, unknown>) => {
    status.replaceChildren();
    const answer = await ask({ type: "wallet:stake-sign", ...body });
    if (answer?.error) return status.append(errorBox(answer.error));
    status.append(
      h("p", { class: "note" }, "Review and sign it in the Tera window that just opened."),
    );
  };

  const positions = st.positions.filter(
    (p) => BigInt(p.active_stake || "0") > 0n || BigInt(p.claimable_rewards || "0") > 0n,
  );
  const locks = st.locks.filter((l) => l.status !== "claimed");

  const amount = h("input", {
    inputmode: "decimal",
    autocomplete: "off",
    placeholder: "0.0",
  }) as HTMLInputElement;
  const term = h(
    "select",
    { "aria-label": "Type" },
    h(
      "option",
      { value: "flexible" },
      `Flexible · ${st.flexibleApr === null ? "variable rate" : `≈ ${st.flexibleApr.toFixed(2)}% a year, variable`}`,
    ),
    ...Object.values(FIXED_TERMS).map((t: { days: number; apyBps: number }) =>
      h(
        "option",
        { value: String(t.days) },
        `${t.days}-day lock · ${t.apyBps / 100}% a year, guaranteed`,
      ),
    ),
  ) as HTMLSelectElement;
  const projection = h("span", { class: "muted small" });
  const project = () => {
    const typed = toUnits(amount.value, 18);
    projection.textContent =
      term.value === "flexible" || typed.error
        ? term.value === "flexible"
          ? "Unstake any time. The rate falls as others stake."
          : ""
        : `Reward at the end: ${tera(fixedReward(typed.units, Number(term.value)))}`;
  };
  amount.addEventListener("input", project);
  term.addEventListener("change", project);
  const go2 = h("button", { class: "primary", type: "submit" }, "Review") as HTMLButtonElement;
  const form = h(
    "form",
    {
      class: "card",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        status.replaceChildren();
        const typed = toUnits(amount.value, 18);
        if (typed.error) return status.append(errorBox(typed.error));
        const short = checkAmount({
          units: typed.units,
          balance: st.balance,
          symbol: "TERA",
          decimals: 18,
        });
        if (short) return status.append(errorBox(short));
        go2.disabled = true;
        go2.textContent = "Checking…";
        const answer = await ask({
          type: "wallet:stake",
          amount: amount.value.trim(),
          term: term.value,
        });
        go2.disabled = false;
        go2.textContent = "Review";
        if (answer?.error) return status.append(errorBox(answer.error));
        status.append(
          h("p", { class: "note" }, "Review and confirm it in the Tera window that just opened."),
        );
      },
    },
    h("strong", {}, "Stake more"),
    h(
      "label",
      {},
      h(
        "span",
        { class: "row" },
        h("span", { class: "grow" }, "Amount (TERA)"),
        h(
          "button",
          {
            class: "small",
            type: "button",
            onclick: () => {
              if (st.balance === null) return;
              amount.value = plainUnits(BigInt(st.balance), 18);
              project();
            },
          },
          "Max",
        ),
      ),
      amount,
    ),
    h(
      "span",
      { class: "muted small" },
      st.balance === null ? "Balance unknown" : `You have ${tera(st.balance)}`,
    ),
    h("label", {}, "Type", term),
    projection,
    go2,
  );
  queueMicrotask(project);

  return [
    back,
    h("h1", {}, "Stake TERA"),
    st.configured ? null : errorBox("Staking is unavailable right now."),
    status,
    ...st.pending.map((p) =>
      h(
        "p",
        { class: "note" },
        `Waiting to be credited: ${tera(p.amount)} ${p.kind === "fixed" ? `(${p.termDays}-day lock)` : "(flexible)"}. Tera credits it after a few confirmations; keep Tera open or come back later.`,
      ),
    ),
    ...positions.map((p) => {
      const staked = BigInt(p.active_stake || "0");
      const claimable = BigInt(p.claimable_rewards || "0");
      return h(
        "section",
        { class: "card" },
        h(
          "strong",
          {},
          p.lock_tier && p.lock_tier !== "flexible" ? `Staked · ${p.lock_tier}` : "Flexible stake",
        ),
        h(
          "dl",
          { class: "rows" },
          h("dt", {}, "Staked"),
          h("dd", {}, tera(staked)),
          h("dt", {}, "Rewards to claim"),
          h("dd", {}, tera(claimable)),
        ),
        p.is_locked
          ? h(
              "p",
              { class: "muted small" },
              `Locked for another ${Math.ceil(Number(p.remaining_lock_seconds || 0) / 86400)} days. Rewards can still be claimed.`,
            )
          : null,
        h(
          "div",
          { class: "actions" },
          h(
            "button",
            {
              class: "primary",
              type: "button",
              disabled: claimable <= 0n,
              onclick: () => request({ kind: "claim", epochId: p.epoch_id }),
            },
            "Claim",
          ),
          h(
            "button",
            {
              type: "button",
              disabled: staked <= 0n || Boolean(p.is_locked),
              onclick: () => request({ kind: "unstake", epochId: p.epoch_id }),
            },
            "Unstake all",
          ),
        ),
      );
    }),
    ...locks.map((l) =>
      h(
        "section",
        { class: "card" },
        h("strong", {}, `${l.term_days}-day lock`),
        h(
          "dl",
          { class: "rows" },
          h("dt", {}, "Locked"),
          h("dd", {}, tera(l.principal_amount)),
          h("dt", {}, "Reward"),
          h("dd", {}, tera(l.reward_amount)),
          h("dt", {}, l.isMatured ? "Ended" : "Unlocks"),
          h("dd", {}, new Date(l.unlocks_at).toLocaleDateString()),
        ),
        l.isMatured
          ? h(
              "button",
              {
                class: "primary",
                type: "button",
                onclick: () => request({ kind: "unlock", lockId: l.id }),
              },
              "Unlock and collect",
            )
          : null,
      ),
    ),
    form,
    st.payouts.length
      ? h(
          "section",
          { class: "card" },
          h("strong", {}, "Recent payouts"),
          h(
            "ul",
            { class: "signed" },
            ...st.payouts.map((p) =>
              h(
                "li",
                {},
                h(
                  "span",
                  { class: "title" },
                  `${p.kind === "claim" ? "Rewards" : p.kind === "unstake" ? "Unstake" : "Payout"} · ${tera(BigInt(p.principal_amount || "0") + BigInt(p.reward_amount || "0"))}`,
                ),
                h(
                  "span",
                  { class: "muted small" },
                  `${p.status} · ${when(Date.parse(p.created_at))}`,
                ),
              ),
            ),
          ),
        )
      : null,
  ].filter((part): part is HTMLElement => part !== null);
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
