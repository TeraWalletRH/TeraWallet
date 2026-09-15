import {
  createApi,
  ApiError,
  executionIssue,
  sendPrepared,
  checkReceipt,
  isAddress,
  isHash,
  sameAddress,
  parseUnits,
  formatUnits,
  errorMessage,
  GATES,
  ZERO_ADDRESS,
} from "./core.js";
import { renderAssistantMarkdown } from "./markdown.js";
import {
  LOCAL_ONLY,
  REQUESTS,
  describeRequest,
  appendLog,
  summarize,
  exportable,
} from "./privacy.js";
import { GUIDE, guideStep, createDemoState, demoApi, DEMO_OWNER } from "./demo.js";

const config = JSON.parse(document.getElementById("tera-config")?.textContent || "{}");
const chainId = Number(config.chainId || 4663);
const apiUrl = config.apiUrl || "https://api.terawallet.app";
const serviceHost = (() => {
  try {
    return new URL(apiUrl).host;
  } catch {
    return apiUrl;
  }
})();
const request = createApi(apiUrl);
// Every service request is recorded for the privacy status centre before it is
// sent. Field names only: no address, amount or message text enters the log.
const api = async (path, body) => {
  const entry = describeRequest(path, body);
  state.privacyLog = appendLog(
    state.privacyLog,
    state.demo ? { ...entry, simulated: true } : entry,
  );
  if (route() === "privacy") queueMicrotask(render);
  if (!state.demo) return request(path, body);
  // The guided demo answers locally under the same success contract as the
  // service, so every code path below behaves exactly as it does in production.
  const payload = demoApi(path, body, chainId);
  if (payload.success !== true)
    throw new ApiError(payload.error || "Blocked by a check in the demo.", payload, 422);
  return payload;
};
const app = document.getElementById("wallet-app");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const short = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—");
const titles = {
  dashboard: "Overview",
  assets: "Asset registry",
  agent: "Agent assistant",
  approvals: "Approvals",
  policy: "Private policy",
  sessions: "Agent sessions",
  receipts: "Receipts",
  privacy: "Privacy status",
  settings: "Settings",
};
const gateLabels = [
  "Asset registry",
  "Eligibility preflight",
  "Policy check",
  "Risk check",
  "Owner approval",
];
const route = () => location.pathname.replace(/\/$/, "").split("/").pop() || "dashboard";
const href = (key) => `/dashboard/${key === "dashboard" ? "" : `${key}/`}`;
const button = (label, action, extra = "") =>
  `<button class="btn" data-action="${action}" ${extra}>${label}</button>`;
const chip = (label, fail = false) =>
  `<span class="chip ${fail ? "fail" : ""}">${esc(label)}</span>`;
const empty = (text) => `<div class="empty">${esc(text)}</div>`;
const pair = (label, value) =>
  `<div class="pair"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
const state = {
  owner: "",
  provider: null,
  chain: null,
  assets: [],
  assetsLoaded: false,
  assetError: "",
  account: null,
  history: [],
  sessions: [],
  errors: {},
  balances: {},
  drafts: [],
  records: [],
  chat: [],
  privacyLog: [],
  demo: false,
  guide: 0,
  busy: false,
  loading: false,
  query: "",
  category: "all",
  hide: false,
  notice: "",
};
let generation = 0;
let polling = false;
const receiptChecks = new Set();

function storageKey() {
  return `tera-wallet-v1:${config.apiUrl || "production"}:${chainId}:${state.owner.toLowerCase()}`;
}
function persist() {
  if (!state.owner) return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state.records));
  } catch {
    state.notice =
      "Browser storage is unavailable. Keep this page open while transactions are pending.";
  }
}
function loadRecords() {
  try {
    const rows = JSON.parse(localStorage.getItem(storageKey()) || "[]");
    state.records = Array.isArray(rows)
      ? rows.filter(
          (r) => isHash(r.txHash) && sameAddress(r.owner, state.owner) && r.chainId === chainId,
        )
      : [];
  } catch {
    state.records = [];
  }
}
function showError(error) {
  state.notice = errorMessage(error);
  render();
}
function connected() {
  if (!state.owner || !state.provider) throw new Error("Connect your wallet to continue.");
}
function correctNetwork() {
  connected();
  if (state.chain !== chainId)
    throw new Error("Switch your wallet to Robinhood Chain to continue.");
}
function assetFor(address) {
  return state.assets.find((a) => sameAddress(a.address, address));
}
function explorer(hash) {
  return config.explorerUrl && isHash(hash)
    ? `<a href="${esc(config.explorerUrl.replace(/\/$/, ""))}/tx/${hash}" target="_blank" rel="noopener noreferrer">${esc(short(hash))} ↗</a>`
    : esc(short(hash));
}
function dialog(title, body) {
  document.getElementById("wallet-dialog")?.remove();
  const previous = document.activeElement;
  const d = document.createElement("dialog");
  d.id = "wallet-dialog";
  d.className = "wallet-dialog";
  d.setAttribute("aria-labelledby", "dialog-heading");
  d.innerHTML = `<div class="dialog-title"><span class="eyebrow">Tera Wallet</span><button class="close-dialog" aria-label="Close dialog" data-action="close">×</button></div><h2 id="dialog-heading">${esc(title)}</h2>${body}`;
  document.body.append(d);
  d.addEventListener("close", () => {
    if (previous?.isConnected) previous.focus();
  });
  d.showModal();
  return d;
}
function closeDialog() {
  document.getElementById("wallet-dialog")?.close();
}
function navigate(key) {
  history.pushState(null, "", href(key));
  render();
  document.querySelector("h1")?.focus();
  window.scrollTo(0, 0);
}

function render() {
  const key = route();
  const view =
    {
      dashboard: overview,
      assets: registry,
      agent: () => `<div class="live-agent panel">${chat()}</div>`,
      approvals,
      policy,
      sessions,
      receipts,
      privacy: privacyCentre,
      settings,
    }[key] || overview;
  app.innerHTML = `<div class="wallet-wrap">
    <header class="wallet-head"><a class="wordmark" href="/"><img src="/tera/logo.png" alt="">TERA WALLET</a><div class="actions">${state.demo ? chip("Guided demo · sample data") : chip(state.owner ? short(state.owner) : "Owner controlled")}${state.demo ? button("Exit demo", "demo-exit") : button(state.owner ? "Wallet ↗" : "Connect wallet ↗", state.owner ? "wallet-account" : "connect", state.busy ? "disabled" : "")}<button class="btn live-menu" aria-expanded="false" aria-controls="wallet-navigation" data-action="menu">Menu</button></div></header>
    <nav id="wallet-navigation" class="wallet-nav" aria-label="Wallet navigation">${Object.entries(
      titles,
    )
      .map(
        ([k, label], i) =>
          `<a href="${href(k)}" ${key === k ? 'class="active" aria-current="page"' : ""}>${String(i + 1).padStart(2, "0")} ${label}</a>`,
      )
      .join("")}</nav>
    <main id="wallet-content"><div class="page-heading"><div><div class="eyebrow">Private authorization / Your authority</div><h1 tabindex="-1">${titles[key] || "Overview"}${key === "dashboard" ? "." : ""}</h1></div><p>The agent proposes. You review the checks and approve in your wallet.</p></div>
    ${state.notice ? `<div class="live-notice" role="alert"><span>${esc(state.notice)}</span>${button("Dismiss", "notice-dismiss")}</div>` : ""}
    ${state.owner && state.chain !== chainId ? `<div class="live-notice" role="status">Your wallet is on a different network. ${button("Switch network", "switch")}</div>` : ""}
    ${guidePanel()}
    ${state.loading ? '<p class="micro" role="status">Refreshing your account…</p>' : ""}${view()}</main>
    <footer class="wallet-footer"><div>© ${new Date().getFullYear()} Tera Wallet<br>Owner signs · Owner pays network fees</div><div class="actions"><a href="/">Website ↗</a><a href="/roadmap/">Roadmap</a>${button("Refresh", "refresh", state.loading ? "disabled" : "")}</div></footer>
  </div>`;
  bindForms();
}

function guidePanel() {
  if (!state.demo) return "";
  const step = guideStep(state.guide);
  const last = state.guide >= GUIDE.length - 1;
  return `<section class="demo-guide" aria-label="Guided demo">
    <div class="demo-banner"><span class="eyebrow">Guided demo · nothing is sent, nothing is signed</span>${chip(`Step ${state.guide + 1} of ${GUIDE.length}`)}</div>
    <div class="demo-steps" role="list">${GUIDE.map(
      (entry, i) =>
        `<button role="listitem" class="demo-step ${i === state.guide ? "current" : ""} ${i < state.guide ? "done" : ""}" data-action="demo-step" data-index="${i}" aria-current="${i === state.guide}">${String(i + 1).padStart(2, "0")} ${esc(entry.title)}</button>`,
    ).join("")}</div>
    <div class="demo-body"><h2>${esc(step.title)}</h2><p>${esc(step.body)}</p>
      <div class="actions">${button(`${esc(step.action)} ↗`, "demo-goto")}${button("Back", "demo-back", state.guide ? "" : "disabled")}${button(last ? "Finish" : "Next", "demo-next")}${button("Reset demo", "demo-reset")}</div>
    </div>
  </section>`;
}
// The demo makes the same calls the wallet makes on a real connection, so the
// privacy log shows the true request shape. Each one is answered locally.
async function runDemoSession() {
  await loadAssets();
  await refreshAccount();
}
function startDemo(notice = "") {
  generation++;
  Object.assign(state, createDemoState(chainId), { demo: true, guide: 0, notice });
  // Simulated entries belong to the run being replaced; real ones are left alone.
  state.privacyLog = state.privacyLog.filter((entry) => !entry.simulated);
  navigate(guideStep(0).route);
  void runDemoSession();
}
function resetDemo() {
  startDemo("Demo reset. Sample data and the simulated request log are back to the start.");
}
function exitDemo() {
  const wasDemo = state.demo;
  state.demo = false;
  state.guide = 0;
  clearAccount();
  state.assets = [];
  state.assetsLoaded = false;
  state.privacyLog = state.privacyLog.filter((entry) => !entry.simulated);
  if (wasDemo)
    state.notice = "Guided demo closed. Sample data and simulated requests were cleared.";
  render();
  void loadAssets();
}
function accountPrompt() {
  return `<div class="panel"><h2>Your wallet. Your authority.</h2><p>Connect a browser wallet to load your balances, prepare proposals, and review account activity.</p><p class="micro">Or walk the whole privacy boundary first with sample data. The guided demo sends nothing and signs nothing.</p><div class="actions">${button("Connect wallet ↗", "connect")}${button("Start guided demo", "demo-start")}</div></div>`;
}
function overview() {
  const balanceRows = state.assets
    .filter((a) => state.balances[a.address] !== undefined)
    .map(
      (a) =>
        `<div class="asset-mini"><span class="asset-symbol">${esc(a.symbol.slice(0, 2))}</span><div><b>${esc(a.symbol)}</b><small>${esc(a.category)}</small></div><div class="val">${state.hide ? "••••" : esc(state.balances[a.address])}</div></div>`,
    )
    .join("");
  return `${!state.owner ? accountPrompt() : ""}<div class="workspace"><aside class="column"><div class="section-label"><span>Your holdings</span>${button(state.hide ? "Show" : "Hide", "privacy")}</div>${balanceRows || empty(state.owner ? "Balances load on the selected network." : "Connect to view your holdings.")}${state.errors.balances ? `<p class="micro">${esc(state.errors.balances)}</p>` : ""}<p class="micro">Token balances in native units. Market valuations are unavailable.</p><img class="portfolio-art" src="/tera/art/02-case-stairway.jpg" alt="Architectural stairway collage"></aside><section class="column"><div class="section-label"><span>Action inbox</span>${button("+ New proposal", "create")}</div>${state.drafts.length ? state.drafts.map(proposalCard).join("") : empty("No proposals in this session. Prepare an action to review it here.")}</section><aside class="column">${chat()}</aside></div><div class="lower-row"><section><div class="section-label"><span>Account activity</span><a href="${href("receipts")}">View history ↗</a></div>${state.errors.account ? empty(state.errors.account) : pair("Confirmed intents reported by Tera", state.account?.stats?.intents?.confirmed_intents ?? "—")}${pair("Transactions tracked on this device", state.records.length)}</section><section><div class="section-label">Your control surface</div><div class="quick-grid"><a href="${href("approvals")}">Approvals ↗</a><a href="${href("sessions")}">Agent sessions ↗</a><a href="${href("policy")}">Private policy ↗</a><a href="${href("assets")}">Asset registry ↗</a></div></section></div>`;
}
function registry() {
  if (state.assetError)
    return `<div class="panel" role="alert"><p>${esc(state.assetError)}</p>${button("Retry loading assets", "assets-retry")}</div>`;
  if (!state.assetsLoaded) return empty("Loading the asset registry…");
  const filtered = state.assets.filter(
    (a) =>
      `${a.symbol} ${a.name}`.toLowerCase().includes(state.query.toLowerCase()) &&
      (state.category === "all" || a.category === state.category),
  );
  return `<form id="asset-filter" class="toolbar"><input class="search" name="query" aria-label="Search assets" placeholder="Search assets or symbols…" value="${esc(state.query)}"><select name="category" aria-label="Asset category">${["all", ...new Set(state.assets.map((a) => a.category))].map((c) => `<option ${state.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select><button class="btn">Search</button>${chip(`${state.assets.length} registry entries`)}</form><div class="table-scroll"><table><thead><tr><th>Asset</th><th>Type</th><th>Registry status</th><th>Contract</th><th>Details</th></tr></thead><tbody>${filtered.map((a) => `<tr><td><b>${esc(a.symbol)}</b><small>${esc(a.name)}</small></td><td>${esc(a.category)}</td><td>${chip(a.status, a.status !== "ACTIVE")}</td><td>${isAddress(a.address) ? esc(short(a.address)) : chip("Invalid address", true)}</td><td>${button("Inspect ↗", "asset", `data-symbol="${esc(a.symbol)}"`)}</td></tr>`).join("")}</tbody></table>${filtered.length ? "" : empty("No assets match your search.")}</div><p class="micro">Registry information is supplied by Tera. A registry entry does not establish transfer eligibility.</p>`;
}
function chat() {
  return `<div class="section-label">Agent assistant ${chip("Owner supervised")}</div><div class="note">Ask a question or request an action. Only the message you submit and the wallet address needed for a proposal are sent.</div><div class="chat-feed" aria-live="polite">${state.chat.length ? state.chat.map((m) => `<div class="chat-bubble ${m.role === "user" ? "user" : ""}"><strong class="chat-role">${m.role === "user" ? "You" : "Tera assistant"}</strong>${m.role === "assistant" ? `<div class="assistant-markdown">${renderAssistantMarkdown(m.text)}</div>` : esc(m.text)}</div>`).join("") : '<p class="micro">Explore an asset or describe a proposal you want to review.</p>'}</div><form id="chat-form"><div class="field"><label for="chat-mode">Message type</label><select id="chat-mode" name="mode"><option value="chat">Ask a question</option><option value="propose">Prepare a proposal</option></select></div><div class="composer"><textarea name="message" aria-label="Message the agent" placeholder="Ask about an asset or describe an action…" required maxlength="1200"></textarea><button aria-label="Send message" ${state.busy ? "disabled" : ""}>↑</button></div><p class="micro">Messages are processed by Tera’s assistant service. Proposals always require your review.</p></form>`;
}
function proposalCard(p, index = state.drafts.indexOf(p)) {
  const intent = p.intent || p.preparedTransaction?.intent;
  const asset = assetFor(intent?.assetAddress);
  const inputAsset =
    intent?.actionType === "BUY"
      ? state.assets.find((candidate) => candidate.symbol === "USDG")
      : asset;
  const issue = p.error || executionIssue(p, state.owner, chainId);
  const submitted = Boolean(p.txHash);
  let amount = intent?.amount ?? "—";
  try {
    if (inputAsset && intent)
      amount = `${formatUnits(intent.amount, inputAsset.decimals)} ${inputAsset.symbol}`;
  } catch {
    /* Raw amount remains visible. */
  }
  return `<article class="proposal"><div class="proposal-top"><span class="eyebrow">${esc(intent?.actionType || "Proposal")}</span>${chip(submitted ? "Submitted" : issue ? "Needs attention" : "Awaiting owner", !submitted && !!issue)}</div><h2>${esc(asset?.name || "Action review")}</h2>${p.explanation ? `<p class="lead">${esc(p.explanation)}</p>` : ""}
    <ul class="status-list">${GATES.map((name, i) => {
      const g = p.gates?.find((g) => g.gate === name);
      return `<li class="${g?.passed === false ? "blocked" : ""}"><span class="audit-num">0${i + 1}</span><span>${gateLabels[i]}${g?.reason ? `<small>${esc(g.reason)}</small>` : ""}</span><b>${i === 4 && g?.passed ? "AWAITING SIGNATURE" : g ? (g.passed ? "PASS" : "BLOCKED") : "NOT RUN"}</b></li>`;
    }).join("")}</ul>
    ${pair(intent?.actionType === "BUY" ? "USDG input" : "Amount reported by service", amount)}${(intent?.actionType === "BUY" || intent?.actionType === "SELL") ? pair("Quoted output", (p.quote || p.preparedTransaction?.quote)?.amountOut ? `${esc((p.quote || p.preparedTransaction.quote).amountOut)} · ${esc((p.quote || p.preparedTransaction.quote).route || "live route")}` : "Quote unavailable") : ""}${intent?.recipient ? pair("Recipient", intent.recipient) : ""}${p.preparedTransaction ? pair("Transaction target", p.preparedTransaction.to) : ""}
    ${submitted ? `<p>Transaction: ${explorer(p.txHash)}</p>` : issue ? `<p class="live-blocked">${esc(issue)}</p>` : '<p class="micro">Review the token amount and recipient. Your wallet will ask you to sign and pay the network fee.</p>'}
    <div class="actions">${button("Approve in wallet ↗", "approve", `data-index="${index}" ${issue || submitted || state.busy || state.chain !== chainId ? "disabled" : ""}`)}${button("Prepare again", "reprepare", `data-index="${index}" ${state.busy || submitted || !intent ? "disabled" : ""}`)}${button("Dismiss", "draft-dismiss", `data-index="${index}" ${state.busy ? "disabled" : ""}`)}</div></article>`;
}
function approvals() {
  return `<div class="toolbar">${button("+ New proposal", "create")}${chip("Review before signing")}</div>${state.drafts.map(proposalCard).join("") || empty("No proposals in this session. Create a new proposal to run the checks.")}<p class="micro">Quote-based proposals may expire when the backend supplies an expiry. Transfers remain reviewable until you dismiss them. Pending transactions remain in Receipts.</p>`;
}
function policy() {
  return `<div class="content-grid"><section class="panel"><div class="eyebrow">Service availability</div><h2>Private rules need a connected policy service.</h2><p>Personal spending limits cannot be viewed or changed yet. Tera currently applies a fixed server-side per-trade check.</p><p class="micro">Your old demo settings are not applied to wallet transactions. A passing proposal check does not establish that a personal daily limit was enforced.</p><button class="btn" disabled>Policy editing unavailable</button></section><aside class="panel"><h2>Your approval remains required.</h2><p>Every executable proposal is reviewed by you before your wallet signs it.</p><a class="btn" href="${href("approvals")}">Review proposals ↗</a></aside></div>`;
}
function sessions() {
  if (!state.owner) return accountPrompt();
  return `<div class="note">Session records are read from Tera. Creating or revoking on-chain permissions requires a deployed smart account; this connected-wallet flow does not provide one.</div>${state.errors.sessions ? empty(state.errors.sessions) : state.sessions.map((s) => `<article class="panel live-session">${pair("Session key", s.session_key_address || s.sessionKeyAddress)}${pair("Expires", s.expires_at || s.expiresAt)}${chip(s.is_revoked || s.isRevoked ? "Recorded as revoked" : Date.parse(s.expires_at || s.expiresAt) <= Date.now() ? "Expired" : "Registered")}<p class="micro">Status from the service; on-chain authority has not been verified.</p></article>`).join("") || empty("No sessions returned for this wallet.")}<button class="btn" disabled>Create session unavailable</button>`;
}
function receipts() {
  if (!state.owner) return accountPrompt();
  return `<div class="section-label">Transactions tracked on this device</div>${state.records.map((r, i) => `<article class="panel live-record"><div class="proposal-top"><b>${esc(r.action || "Transaction")}</b>${chip(r.status === "confirmed" ? (r.recorded ? "Confirmed · recorded" : "Confirmed · audit sync pending") : r.status, r.status === "reverted")}</div>${pair("Submitted", r.createdAt)}<p>${explorer(r.txHash)}</p>${r.error ? `<p class="micro">${esc(r.error)}</p>` : ""}<div class="actions">${r.status !== "reverted" && !r.recorded ? button("Check status / retry audit sync", "receipt-check", `data-index="${i}" ${state.busy ? "disabled" : ""}`) : ""}${button("Export receipt", "receipt-export", `data-index="${i}"`)}</div></article>`).join("") || empty("No transactions tracked on this device.")}
    <div class="section-label live-history-heading">Account history from Tera</div>${state.errors.history ? empty(state.errors.history) : `<div class="table-scroll"><table><thead><tr><th>Action</th><th>Service status</th><th>Created</th><th>Transaction</th></tr></thead><tbody>${state.history.map((r) => `<tr><td>${esc(r.intent_type || r.intent?.actionType || "—")}</td><td>${esc(r.status)}</td><td>${esc(r.created_at || r.createdAt)}</td><td>${r.tx_hash ? explorer(r.tx_hash) : "—"}</td></tr>`).join("")}</tbody></table>${state.history.length ? "" : empty("No history returned by the service.")}</div>`}`;
}
function privacyCentre() {
  const totals = summarize(state.privacyLog);
  const time = (at) =>
    new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const list = (items, fallback) =>
    items.length ? items.map((item) => esc(item)).join(" · ") : fallback;
  // A simulated request never left the page, so it cannot claim anything was sent.
  const addressChip = (entry) =>
    entry.simulated
      ? entry.identifies
        ? "Would carry your address"
        : "No address in this request"
      : entry.identifies
        ? "Address sent"
        : "No address sent";
  return `<div class="privacy-totals">
      <div class="metric"><strong>${totals.requests}</strong><small>Requests recorded in this page session</small></div>
      ${totals.simulated ? `<div class="metric"><strong>${totals.simulated}</strong><small>Answered locally by the demo · never sent</small></div>` : ""}
      <div class="metric"><strong>${totals.identifying}</strong><small>Requests carrying your wallet address</small></div>
      <div class="metric"><strong>${totals.toModelProvider}</strong><small>Requests whose text reached the model provider</small></div>
      <div class="metric"><strong>${totals.fields}</strong><small>Distinct fields sent</small></div>
    </div>
    <div class="note"><strong>Data boundary</strong>Requests go to ${esc(serviceHost)}. Balances and receipts are read directly through your wallet's network provider, so Tera does not see them. The log below records field names only — never an address, an amount or the text you typed.</div>
    ${
      state.demo
        ? `<div class="note"><strong>Guided demo</strong>Every request below was answered locally. Nothing reached ${esc(serviceHost)} and nothing was signed.</div>`
        : `<div class="note"><strong>Guided demo</strong>Want to show this boundary without a real account? ${button("Start guided demo", "demo-start")}</div>`
    }
    <div class="content-grid privacy-grid">
      <section>
        <div class="section-label"><span>This session's requests</span><div class="actions">${button("Export log", "privacy-export", state.privacyLog.length ? "" : "disabled")}${button("Clear log", "privacy-clear", state.privacyLog.length ? "" : "disabled")}</div></div>
        ${
          state.privacyLog.length
            ? state.privacyLog
                .map(
                  (entry) => `<article class="panel privacy-entry">
              <div class="proposal-top"><b>${esc(entry.label)}</b><span class="actions">${entry.simulated ? chip("Simulated · not sent") : ""}${chip(addressChip(entry), entry.identifies)}</span></div>
              <p class="micro">${esc(entry.purpose)}</p>
              ${pair("Sent", list(entry.sent, "No owner data"))}${pair("Request", `${entry.method} ${entry.path}`)}${pair("Goes to", entry.processors.join(" · "))}${pair("Withheld", list(entry.withheld, "Not documented"))}${pair("Recorded at", time(entry.at))}
              <p class="micro">${esc(entry.retention)}</p>
            </article>`,
                )
                .join("")
            : empty(
                "No service requests yet in this page session. Ask the assistant or prepare a proposal to watch the boundary live.",
              )
        }
      </section>
      <aside>
        <div class="section-label">Never leaves this device</div>
        ${LOCAL_ONLY.map((item) => `<article class="panel privacy-local"><b>${esc(item.label)}</b><p class="micro">${esc(item.detail)}</p></article>`).join("")}
      </aside>
    </div>
    <div class="section-label privacy-catalogue-heading">Every request this wallet can make</div>
    <div class="table-scroll"><table><thead><tr><th>Request</th><th>Fields sent</th><th>Goes to</th><th>Retention</th></tr></thead><tbody>${REQUESTS.map(
      (entry) =>
        `<tr><td><b>${esc(entry.label)}</b><small>${esc(entry.method)} ${esc(entry.path)}</small></td><td class="privacy-wrap">${list(entry.fields, "No owner data")}</td><td class="privacy-wrap">${esc(entry.processors.join(" · "))}</td><td class="privacy-wrap">${esc(entry.retention)}</td></tr>`,
    ).join("")}</tbody></table></div>
    <p class="micro">Retention is described by the service and cannot be verified from this page. Deleting service-side records is not available yet; clearing the log above removes only this local copy.</p>`;
}
function settings() {
  return `<div class="content-grid"><section class="panel"><h2>Wallet connection</h2>${pair("Account", state.owner || "Not connected")}${pair("Network ID", chainId)}${pair("Wallet network", state.chain || "Not connected")}<div class="actions">${button(state.owner ? "Disconnect" : "Connect wallet", state.owner ? "disconnect" : "connect")}${button(state.hide ? "Show balances" : "Hide balances", "privacy")}</div></section><aside class="panel"><h2>Guided private demo</h2><p>Run the wallet on sample data to show the privacy boundary without a real account. No request leaves the page and no transaction can be signed.</p><div class="actions">${state.demo ? button("Reset demo", "demo-reset") + button("Exit demo", "demo-exit") : button("Start guided demo", "demo-start")}</div></aside><aside class="panel"><h2>Data on this device</h2><p>Transaction hashes and audit-sync status are saved to resume tracking after a reload. Proposals and chat stay in this page session. No wallet keys are stored by Tera.</p><p class="micro">Disconnecting clears the current account view. Your wallet extension manages site permissions.</p></aside></div>`;
}

async function loadAssets() {
  state.assetError = "";
  try {
    const result = await api("/api/assets");
    if (!Array.isArray(result.assets))
      throw new Error("The service returned an invalid asset registry.");
    state.assets = result.assets.filter(
      (a) =>
        a &&
        typeof a.symbol === "string" &&
        typeof a.name === "string" &&
        Number.isInteger(a.decimals) &&
        a.decimals >= 0 &&
        a.decimals <= 36,
    );
    state.assetsLoaded = true;
  } catch (error) {
    state.assetError = errorMessage(error);
  }
  render();
}
async function refreshAccount() {
  if (!state.owner) return;
  const version = generation,
    owner = state.owner;
  state.loading = true;
  render();
  const requests = [
    ["account", `/api/account/${owner}`],
    ["history", `/api/account/${owner}/history`],
    ["sessions", `/api/session/${owner}`],
  ];
  const results = await Promise.allSettled(requests.map(([, path]) => api(path)));
  if (version !== generation) return;
  results.forEach((result, i) => {
    const key = requests[i][0];
    if (result.status === "fulfilled" && (key === "account" || Array.isArray(result.value[key]))) {
      state[key] = key === "account" ? result.value : result.value[key];
      delete state.errors[key];
    } else if (result.status === "fulfilled") {
      state.errors[key] = "The service returned an invalid response. Please refresh.";
    } else {
      state.errors[key] = errorMessage(result.reason);
    }
  });
  state.loading = false;
  render();
  await loadBalances(version);
}
async function loadBalances(version = generation) {
  if (!state.provider || state.chain !== chainId) return;
  const provider = state.provider,
    owner = state.owner;
  const valid = state.assets.filter((a) => isAddress(a.address));
  const results = await Promise.allSettled(
    valid.map(async (a) => {
      const value =
        a.address === ZERO_ADDRESS
          ? await provider.request({ method: "eth_getBalance", params: [owner, "latest"] })
          : await provider.request({
              method: "eth_call",
              params: [
                { to: a.address, data: `0x70a08231${owner.slice(2).padStart(64, "0")}` },
                "latest",
              ],
            });
      return [a.address, formatUnits(value, a.decimals)];
    }),
  );
  if (version !== generation) return;
  state.balances = Object.fromEntries(
    results.filter((r) => r.status === "fulfilled").map((r) => r.value),
  );
  if (results.some((r) => r.status === "rejected") || valid.length !== state.assets.length)
    state.errors.balances =
      "Some balances are unavailable because a contract address or network read could not be verified.";
  else delete state.errors.balances;
  render();
}
function clearAccount() {
  generation++;
  state.owner = "";
  state.chain = null;
  state.account = null;
  state.history = [];
  state.sessions = [];
  state.balances = {};
  state.records = [];
  state.drafts = [];
  state.chat = [];
  state.errors = {};
  state.loading = false;
  closeDialog();
}
function clearConnection() {
  clearAccount();
  state.provider = null;
  render();
}
function walletModal(action) {
  if (!window.teraRainbowKit)
    throw new Error("Wallet connections are loading. Please try again in a moment.");
  window.teraRainbowKit[action]();
}
async function setAccount(accounts) {
  clearAccount();
  if (!isAddress(accounts?.[0])) {
    render();
    return;
  }
  const version = generation;
  state.owner = accounts[0];
  try {
    const chain = Number(await state.provider.request({ method: "eth_chainId" }));
    if (version !== generation) return;
    state.chain = chain;
    loadRecords();
    render();
    // Account registration is an API record only; it does not deploy a smart account.
    await api("/api/account/register", {
      ownerAddress: state.owner,
      accountAddress: state.owner,
      chainId,
    });
  } catch (error) {
    if (version === generation) state.notice = errorMessage(error);
  }
  if (version === generation) await refreshAccount();
}
function createProposal(symbol) {
  connected();
  if (!state.assetsLoaded) throw new Error("Load the asset registry before preparing a proposal.");
  const assets = state.assets.filter((a) => isAddress(a.address) && a.status === "ACTIVE");
  dialog(
    "Prepare an exact action.",
    `<form id="proposal-form"><div class="field"><label for="proposal-asset">Asset</label><select id="proposal-asset" name="asset">${assets.map((a) => `<option value="${esc(a.symbol)}" ${a.symbol === symbol ? "selected" : ""}>${esc(a.symbol)} · ${esc(a.name)}</option>`).join("")}</select></div><div class="field"><label for="proposal-action">Action</label><select id="proposal-action" name="action"><option>TRANSFER</option><option>BUY</option><option>SELL</option></select></div><div class="field"><label id="proposal-amount-label" for="proposal-amount">Token amount</label><input id="proposal-amount" name="amount" inputmode="decimal" required placeholder="0.00" pattern="[0-9]+(\\.[0-9]+)?"></div><div class="field"><label for="proposal-recipient">Recipient</label><input id="proposal-recipient" name="recipient" placeholder="Required for transfers" autocomplete="off"></div><p id="proposal-help" class="micro"></p><p class="live-form-error" role="alert"></p><button class="btn primary">Run the checks ↗</button></form>`,
  );
  const form = document.getElementById("proposal-form");
  const updateProposalFields = () => {
    const data = new FormData(form);
    const action = data.get("action");
    const asset = assets.find((candidate) => candidate.symbol === data.get("asset"));
    const amountLabel = document.getElementById("proposal-amount-label");
    const help = document.getElementById("proposal-help");
    const recipient = document.getElementById("proposal-recipient");
    if (!amountLabel || !help || !recipient || !asset) return;
    if (action === "BUY") {
      amountLabel.textContent = "USD amount to spend (USDG)";
      help.textContent =
        "Prepared as USDG input. Signing stays disabled until the quote service returns a verified output amount.";
      recipient.placeholder = "Optional";
    } else {
      amountLabel.textContent = `Amount to ${action === "SELL" ? "sell" : "transfer"} (${asset.symbol})`;
      help.textContent =
        action === "TRANSFER"
          ? "Transfers can be approved after all checks pass."
          : "Prepared as token input. Signing stays disabled until the quote service returns a verified output amount.";
      recipient.placeholder = action === "TRANSFER" ? "Required for transfers" : "Optional";
    }
  };
  form.addEventListener("change", updateProposalFields);
  updateProposalFields();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button");
    submit.disabled = true;
    try {
      const data = new FormData(form),
        asset = assets.find((a) => a.symbol === data.get("asset"));
      if (!asset) throw new Error("Select a valid asset.");
      const actionType = data.get("action"),
        recipient = data.get("recipient").trim();
      if (actionType === "TRANSFER" && !isAddress(recipient))
        throw new Error("Enter a valid recipient address.");
      const rawAmount = data.get("amount").trim();
      const amount =
        actionType === "BUY" ? parseUnits(rawAmount, 6) : parseUnits(rawAmount, asset.decimals);
      const maxSpendUsdCents = actionType === "BUY" ? Number(parseUnits(rawAmount, 2)) : undefined;
      if (maxSpendUsdCents !== undefined && !Number.isSafeInteger(maxSpendUsdCents))
        throw new Error("USD amount is outside the supported range.");
      const intent = {
        ownerAddress: state.owner,
        accountAddress: state.owner,
        assetAddress: asset.address,
        actionType,
        amount,
        ...(actionType === "TRANSFER" ? { recipient } : {}),
        ...(maxSpendUsdCents === undefined ? {} : { maxSpendUsdCents }),
      };
      await prepare(intent);
      closeDialog();
      navigate("approvals");
    } catch (error) {
      form.querySelector('[role="alert"]').textContent = errorMessage(error);
    } finally {
      submit.disabled = false;
    }
  };
}
async function prepare(intent) {
  connected();
  if (state.busy) throw new Error("Wait for the current request to finish.");
  const version = generation;
  state.busy = true;
  try {
    let result;
    try {
      result = await api("/api/intent/prepare", intent);
    } catch (error) {
      if (!error.payload?.gates) throw error;
      result = error.payload;
    }
    if (version !== generation) throw new Error("Your wallet changed. Prepare a new proposal.");
    // Keep the owner's requested intent for calldata comparison, never replace it
    // with a service-supplied owner, recipient or amount.
    state.drafts.unshift({ ...result, intent, preparedAt: Date.now() });
  } finally {
    state.busy = false;
    render();
  }
}

function bindForms() {
  const filter = document.getElementById("asset-filter");
  if (filter)
    filter.onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(filter);
      state.query = data.get("query");
      state.category = data.get("category");
      render();
    };
  const form = document.getElementById("chat-form");
  if (form)
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (state.busy) return;
      const data = new FormData(form),
        message = data.get("message").trim(),
        mode = data.get("mode");
      if (!message) return;
      try {
        if (mode === "propose") connected();
      } catch (error) {
        showError(error);
        return;
      }
      const version = generation;
      state.chat.push({ role: "user", text: message });
      state.busy = true;
      render();
      try {
        let result;
        try {
          result = await api(
            mode === "propose" ? "/api/agent/propose" : "/api/agent/chat",
            mode === "propose" ? { prompt: message, ownerAddress: state.owner } : { message },
          );
        } catch (error) {
          if (!error.payload?.gates) throw error;
          result = error.payload;
        }
        if (version !== generation) return;
        state.chat.push({
          role: "assistant",
          text:
            result.reply ||
            result.explanation ||
            result.error ||
            "Review the proposal in Approvals.",
        });
        if (mode === "propose") {
          // Agent proposals are reviewed here; manual preparation persists the
          // exact intent through the API before any executable approval.
          state.drafts.unshift({
            ...result,
            preparedAt: Date.now(),
            ...(result.error ? { error: result.error } : {}),
          });
        }
      } catch (error) {
        if (version === generation)
          state.chat.push({ role: "assistant", text: errorMessage(error) });
      } finally {
        state.busy = false;
        render();
      }
    };
}

async function approve(index) {
  correctNetwork();
  if (state.busy) return;
  const proposal = state.drafts[index];
  if (!proposal || proposal.txHash) return;
  const provider = state.provider,
    owner = state.owner,
    version = generation;
  state.busy = true;
  state.notice = "Checking the transfer before opening your wallet…";
  render();
  try {
    const hash = await sendPrepared(provider, proposal, owner, chainId, () => {
      if (version !== generation) throw new Error("Your wallet changed. Review a new proposal.");
      state.notice = "Review and confirm the transaction in your wallet.";
      render();
    });
    proposal.txHash = hash;
    const record = {
      owner,
      chainId,
      txHash: hash,
      actionHash: proposal.preparedTransaction.actionHash,
      to: proposal.preparedTransaction.to,
      action: proposal.intent.actionType,
      status: "pending",
      recorded: false,
      createdAt: new Date().toISOString(),
    };
    if (version === generation) {
      state.records.unshift(record);
      persist();
      state.notice = "Transaction submitted. Waiting for on-chain confirmation.";
      navigate("receipts");
    } else {
      // A wallet event during the confirmation popup must not lose the hash.
      const key = `tera-wallet-v1:${config.apiUrl || "production"}:${chainId}:${owner.toLowerCase()}`;
      try {
        const rows = JSON.parse(localStorage.getItem(key) || "[]");
        localStorage.setItem(key, JSON.stringify([record, ...(Array.isArray(rows) ? rows : [])]));
      } catch {
        state.notice = `Transaction submitted: ${hash}. Keep this hash to check it in your wallet.`;
      }
    }
  } catch (error) {
    if (version === generation) {
      state.notice = errorMessage(error);
      // Reaching the signature is the point of the demo's approval step.
      if (state.demo && guideStep(state.guide).id === "approve") state.guide += 1;
    }
  } finally {
    state.busy = false;
    render();
  }
}
async function updateReceipt(record) {
  correctNetwork();
  if (receiptChecks.has(record.txHash)) return;
  receiptChecks.add(record.txHash);
  const version = generation;
  try {
    const status = await checkReceipt(state.provider, record, chainId);
    if (version !== generation) return;
    record.status = status;
    record.error = "";
    // Never re-send a transaction when audit persistence fails.
    if (status === "confirmed" && !record.recorded) {
      const result = await api("/api/intent/receipt", {
        actionHash: record.actionHash,
        txHash: record.txHash,
        recipient: record.owner,
      });
      if (version !== generation) return;
      record.recorded = true;
      record.receiptId = result.receiptId;
    }
  } catch (error) {
    if (version === generation) record.error = errorMessage(error);
  } finally {
    receiptChecks.delete(record.txHash);
  }
  if (version === generation) {
    persist();
    render();
  }
}
function downloadJson(data, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportReceipt(index) {
  const record = state.records[index];
  if (!record) return;
  downloadJson(
    {
      chainId: record.chainId,
      transactionHash: record.txHash,
      actionHash: record.actionHash,
      status: record.status,
      recordedByTera: record.recorded,
      receiptId: record.receiptId,
    },
    `tera-${record.txHash.slice(0, 12)}.json`,
  );
}
function exportPrivacyLog() {
  if (!state.privacyLog.length) return;
  downloadJson(exportable(state.privacyLog, serviceHost), `tera-privacy-log-${Date.now()}.json`);
}
function inspectAsset(symbol) {
  const a = state.assets.find((a) => a.symbol === symbol);
  if (!a) return;
  dialog(
    a.name,
    `${pair("Symbol", a.symbol)}${pair("Issuer", a.issuer)}${pair("Contract", a.address)}${pair("Token precision", a.decimals)}<p>${esc(a.description)}</p><div id="asset-preflight" role="status"></div><div class="actions">${button("Check preflight", "preflight", `data-symbol="${esc(a.symbol)}" ${!state.owner || !isAddress(a.address) ? "disabled" : ""}`)}${button("Prepare action", "asset-propose", `data-symbol="${esc(a.symbol)}" ${!state.owner || !isAddress(a.address) ? "disabled" : ""}`)}</div>`,
  );
}

document.addEventListener("click", async (event) => {
  const link = event.target.closest("a[href]");
  if (
    link &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !link.target &&
    event.button === 0
  ) {
    const url = new URL(link.href, location.href);
    const key = url.pathname.replace(/\/$/, "").split("/").pop();
    if (url.origin === location.origin && url.pathname.startsWith("/dashboard") && titles[key]) {
      event.preventDefault();
      navigate(key);
      return;
    }
  }
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) return;
  const action = target.dataset.action,
    index = Number(target.dataset.index);
  try {
    if (action === "close") closeDialog();
    if (action === "connect") walletModal("connect");
    if (action === "wallet-account") walletModal("account");
    if (action === "disconnect") walletModal("disconnect");
    if (action === "switch") walletModal("network");
    if (action === "menu") {
      const expanded = target.getAttribute("aria-expanded") !== "true";
      target.setAttribute("aria-expanded", String(expanded));
      document.getElementById("wallet-navigation").classList.toggle("live-open", expanded);
    }
    if (action === "notice-dismiss") {
      state.notice = "";
      render();
    }
    if (action === "privacy") {
      state.hide = !state.hide;
      render();
    }
    if (action === "refresh") {
      await loadAssets();
      await refreshAccount();
    }
    if (action === "assets-retry") await loadAssets();
    if (action === "create" || action === "asset-propose") createProposal(target.dataset.symbol);
    if (action === "asset") inspectAsset(target.dataset.symbol);
    if (action === "draft-dismiss") {
      state.drafts.splice(index, 1);
      render();
    }
    if (action === "reprepare") {
      const p = state.drafts[index];
      if (p?.intent) {
        await prepare(p.intent);
        state.drafts = state.drafts.filter((d) => d !== p);
        render();
      }
    }
    if (action === "approve") await approve(index);
    if (action === "receipt-export") exportReceipt(index);
    if (action === "demo-start") startDemo();
    if (action === "demo-exit") exitDemo();
    if (action === "demo-reset") resetDemo();
    if (action === "demo-goto") navigate(guideStep(state.guide).route);
    if (action === "demo-step" && Number.isInteger(index)) {
      state.guide = index;
      navigate(guideStep(index).route);
    }
    if (action === "demo-back") {
      state.guide = Math.max(state.guide - 1, 0);
      navigate(guideStep(state.guide).route);
    }
    if (action === "demo-next") {
      if (state.guide >= GUIDE.length - 1) {
        state.notice = "That is the whole boundary. Reset the demo to run it again.";
        render();
      } else {
        state.guide += 1;
        navigate(guideStep(state.guide).route);
      }
    }
    if (action === "privacy-export") exportPrivacyLog();
    if (action === "privacy-clear") {
      state.privacyLog = [];
      render();
    }
    if (action === "receipt-check" && state.records[index])
      await updateReceipt(state.records[index]);
    if (action === "preflight") {
      connected();
      const version = generation,
        a = state.assets.find((a) => a.symbol === target.dataset.symbol);
      target.disabled = true;
      const result = await api("/api/assets/preflight", {
        assetAddress: a.address,
        walletAddress: state.owner,
      });
      const output = document.getElementById("asset-preflight");
      if (version === generation && output)
        output.textContent = result.canTransfer
          ? "Service check passed. Transfer restrictions must still pass transaction simulation."
          : result.reason || "Service check did not pass.";
      target.disabled = false;
    }
  } catch (error) {
    showError(error);
  }
});
window.addEventListener("tera:wallet-change", (event) => {
  const connection = event.detail;
  if (!connection) {
    clearConnection();
    return;
  }
  if (!connection.provider?.request || !isAddress(connection.address)) return;
  if (state.demo) exitDemo();
  if (
    state.provider === connection.provider &&
    sameAddress(state.owner, connection.address) &&
    state.chain === connection.chainId
  )
    return;
  state.provider = connection.provider;
  void setAccount([connection.address]);
});
window.addEventListener("tera:wallet-error", (event) => showError(new Error(event.detail)));
window.addEventListener("popstate", render);
setInterval(async () => {
  if (polling || state.busy || !state.owner || state.chain !== chainId || document.hidden) return;
  const record = state.records.find((r) => r.status === "pending");
  if (!record) return;
  polling = true;
  try {
    await updateReceipt(record);
  } finally {
    polling = false;
  }
}, 6000);
// Expiry disables visible approvals even if no other UI event has occurred.
setInterval(() => {
  document.querySelectorAll('[data-action="approve"]').forEach((button) => {
    const p = state.drafts[Number(button.dataset.index)];
    if (executionIssue(p, state.owner, chainId)) {
      button.disabled = true;
      button.title = "Prepare again to refresh the checks.";
    }
  });
}, 1000);
render();
void loadAssets();
