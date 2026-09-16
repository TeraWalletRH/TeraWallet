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
  evaluateLocalPolicy,
} from "./core.js";
import { renderAssistantMarkdown } from "./markdown.js";
import { verifyPolicyBundle } from "/tera/connect/policy-verify.js";
import { decryptVault, encryptVault, unlockVault } from "./vault.js";
import { bridgeView, bridgeFormInput, checkBridgeQuote, sendBridge } from "./bridge.js";
import {
  LOCAL_ONLY,
  REQUESTS,
  describeRequest,
  appendLog,
  summarize,
  exportable,
} from "./privacy.js";
import { GUIDE, guideStep, createDemoState, demoApi, DEMO_OWNER } from "./demo.js";
import { redactProposal, toText, leaks, formatExact } from "./redact.js";
import {
  parties,
  egressStatus,
  egressSummary,
  exportableEgress,
  REACH,
} from "./egress.js";
import {
  minimise,
  rehydrate,
  residual,
  summary as minimiseSummary,
  keptKinds,
  KIND_LABELS,
  PROPOSE_KEEP,
} from "./minimise.js";
import { GATE_LABELS, explainGate, localChecks, localSummary } from "./checks.js";
import { snapshot, appendVersion, versionTrail, pruneVersions, formatAmount } from "./history.js";
import {
  STAGES,
  SIDE_NOTES,
  OWNER,
  stagesFor,
  initialProgress,
  applyStage,
  progressSummary,
  boundaryIndex,
} from "./boundary.js";
import { describeTransaction } from "./preview.js";
import {
  ACTIONS,
  createPreset,
  upsertPreset,
  removePreset,
  simulate,
  presetSummary,
} from "./simulator.js";

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
const api = async (path, body, options = {}) => {
  // `privacy` records what this device did to the body before it was built —
  // counts and flags only, never a value.
  const { privacy, ...rest } = options;
  const entry = { ...describeRequest(path, body), ...privacy };
  state.privacyLog = appendLog(
    state.privacyLog,
    state.demo ? { ...entry, simulated: true } : entry,
  );
  if (route() === "privacy") queueMicrotask(render);
  if (!state.demo) return request(path, body, rest);
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
  bridge: "Bridge",
  policy: "Private policy",
  sessions: "Agent sessions",
  receipts: "Receipts",
  privacy: "Privacy status",
  settings: "Settings",
};
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
  bridges: [],
  chat: [],
  privacyLog: [],
  policyBundle: null,
  versions: {},
  approval: null,
  presets: [],
  simulation: null,
  policyError: "",
  vaultKey: null,
  agentSessionToken: "",
  vaultRetentionDays: 30,
  minimise: true,
  minimiseReview: true,
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
function vaultStorageKey() {
  return `${storageKey()}:encrypted`;
}
function vaultSettingsKey() {
  return `${storageKey()}:retention`;
}
async function persist() {
  if (!state.owner || !state.vaultKey) return;
  const targetStorageKey = vaultStorageKey();
  try {
    const vault = await encryptVault(
      state.vaultKey,
      {
        records: state.records,
        bridges: state.bridges,
        drafts: state.drafts,
        versions: state.versions,
        agentSessionToken: state.agentSessionToken,
        presets: state.presets,
      },
      state.vaultRetentionDays,
    );
    localStorage.setItem(targetStorageKey, JSON.stringify(vault));
  } catch {
    state.notice =
      "Encrypted browser storage is unavailable. Keep this page open while transactions are pending.";
  }
}
function loadRecords() {
  state.bridges = [];
  state.records = [];
  state.drafts = [];
  state.versions = {};
  state.presets = [];
  state.simulation = null;
  const stored = Number(localStorage.getItem(vaultSettingsKey()));
  state.vaultRetentionDays = [7, 30, 90, 365].includes(stored) ? stored : 30;
}
async function unlockEncryptedStorage() {
  connected();
  const key = await unlockVault(state.provider, state.owner, chainId);
  const raw = localStorage.getItem(vaultStorageKey());
  const vault = raw ? await decryptVault(key, JSON.parse(raw)) : null;
  state.vaultKey = key;
  state.records = Array.isArray(vault?.records)
    ? vault.records.filter(
        (r) => isHash(r.txHash) && sameAddress(r.owner, state.owner) && r.chainId === chainId,
      )
    : [];
  state.drafts = Array.isArray(vault?.drafts) ? vault.drafts : [];
  state.bridges = Array.isArray(vault?.bridges) ? vault.bridges.filter(r => sameAddress(r.ownerAddress, state.owner) && isHash(r.requestId)) : [];
  // Version history follows the same retention window as the rest of the vault.
  state.versions = pruneVersions(vault?.versions, state.vaultRetentionDays);
  state.agentSessionToken = typeof vault?.agentSessionToken === "string" ? vault.agentSessionToken : "";
  state.presets = Array.isArray(vault?.presets) ? vault.presets.map(createPreset) : [];
  // Remove the previous plaintext record store after the encrypted vault unlocks.
  localStorage.removeItem(storageKey());
}
function clearEncryptedStorage() {
  if (!state.owner) return;
  localStorage.removeItem(vaultStorageKey());
  localStorage.removeItem(storageKey());
  state.records = [];
  state.bridges = [];
  state.drafts = [];
  state.agentSessionToken = "";
}
async function deleteServerAssistantData() {
  connected();
  const timestamp = Date.now();
  const message = `Tera Wallet data deletion\nWallet: ${state.owner.toLowerCase()}\nTimestamp: ${timestamp}`;
  const signature = await state.provider.request({ method: "personal_sign", params: [message, state.owner] });
  const result = await api(`/api/account/${state.owner}/assistant-data`, { signature, timestamp }, { method: "DELETE" });
  state.notice = `Stored assistant proposal data deleted (${result.redactedIntents} redacted). Confirmed receipts remain.`;
}
function clearLocalAssistantData() {
  state.chat = [];
  state.drafts = [];
  state.versions = {};
  state.presets = [];
  state.privacyLog = [];
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
  if (key === "policy")
    void loadPolicyBundle()
      .then(render)
      .catch((error) => {
        state.policyError = errorMessage(error);
        render();
      });
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
      bridge: () => bridgeView({ esc, pair, button, records: state.bridges, owner: state.owner, demo: state.demo }),
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
function minimiseHint() {
  return state.minimise
    ? "Addresses, references, contact details and figures are replaced with placeholders on this device before the message is sent. The reply is re-hydrated here. This removes the values, not the context — it does not make you anonymous."
    : "Your message is sent exactly as you typed it, including any address, reference or figure it contains.";
}
// Both sides of the same message, drawn from one segment list so the comparison
// cannot drift from what is actually sent.
function minimiseSegments(segments) {
  return segments
    .map((segment) =>
      segment.kind
        ? `<mark class="minimise-mark${segment.kept ? " kept" : ""}">${esc(segment.text)}</mark>`
        : esc(segment.text),
    )
    .join("");
}
function chatBubble(message) {
  if (message.role !== "user")
    return `<div class="chat-bubble"><strong class="chat-role">Tera assistant</strong><div class="assistant-markdown">${renderAssistantMarkdown(message.text)}</div></div>`;
  const replaced = message.removed?.length || 0;
  const detail = message.minimised
    ? `<details class="minimise-sent"><summary>${replaced} ${replaced === 1 ? "value" : "values"} replaced · what left this device</summary><pre>${esc(message.sent)}</pre>${message.kept?.length ? `<p class="micro">Kept as typed: ${esc(message.kept.map((kind) => KIND_LABELS[kind].toLowerCase()).join(", "))}.</p>` : ""}</details>`
    : `<p class="micro minimise-sent-plain">Sent as typed.</p>`;
  return `<div class="chat-bubble user"><strong class="chat-role">You</strong>${esc(message.text)}${detail}</div>`;
}
function chat() {
  return `<div class="section-label">Agent assistant ${chip("Owner supervised")}</div>
    <div class="note">Ask a question or request an action. Only the message you submit and the wallet address needed for a proposal are sent.</div>
    <div class="toolbar">${state.agentSessionToken ? chip("Scoped token connected") + button("Disconnect token", "agent-token-disconnect") : button("Connect session token", "agent-token-connect", !state.owner ? "disabled" : "")}<label class="share-toggle minimise-toggle"><input type="checkbox" data-action="minimise-toggle" ${state.minimise ? "checked" : ""}> Minimise before sending</label></div>
    <p class="micro" id="minimise-hint">${esc(minimiseHint())}</p>
    <div class="chat-feed" aria-live="polite">${state.chat.length ? state.chat.map(chatBubble).join("") : '<p class="micro">Explore an asset or describe a proposal you want to review.</p>'}</div>
    <form id="chat-form"><div class="field"><label for="chat-mode">Message type</label><select id="chat-mode" name="mode"><option value="chat">Ask a question</option><option value="propose">Prepare a proposal</option></select></div>
    <div class="composer"><textarea name="message" aria-label="Message the agent" placeholder="Ask about an asset or describe an action…" required maxlength="1200"></textarea><button aria-label="Send message" ${state.busy ? "disabled" : ""}>↑</button></div>
    <p class="micro">${state.agentSessionToken ? "This token is checked before Tera prepares a proposal. Wallet approval is still required." : "Messages are processed by Tera’s assistant service. Proposals always require your review."}</p></form>`;
}

function connectAgentSessionToken() {
  connected();
  if (!state.vaultKey)
    throw new Error("Unlock encrypted local storage in Settings before connecting a session token.");
  dialog(
    "Connect a scoped session token",
    `<form id="agent-token-form"><div class="field"><label for="agent-token">Session token</label><input id="agent-token" name="token" autocomplete="off" required></div><p class="micro">The token is kept only in Tera's encrypted local vault and sent to Tera when you prepare an assistant proposal. It is never sent to the model provider.</p><p class="live-form-error" role="alert"></p><button class="btn primary">Connect token ↗</button></form>`,
  );
  const form = document.getElementById("agent-token-form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    const token = new FormData(form).get("token")?.trim();
    if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
      form.querySelector('[role="alert"]').textContent = "Enter a valid session token.";
      return;
    }
    state.agentSessionToken = token;
    await persist();
    closeDialog();
    state.notice = "Scoped session token connected to assistant proposals.";
    render();
  };
}
// What the wallet will actually be asked to sign, in words and in raw fields.
function previewBlock(proposal) {
  const tx = proposal.preparedTransaction;
  const intent = proposal.intent || tx?.intent;
  if (!tx || !intent) return "";
  const preview = describeTransaction({
    tx,
    intent,
    asset: assetFor(intent.assetAddress),
    chainId,
    networkName: config.networkName || "Robinhood Chain",
  });
  if (!preview) return "";
  const attention = preview.flags.filter((entry) => entry.level === "attention").length;
  return `<details class="preview">
    <summary><span>What you are signing</span><b>${attention ? `${attention} to check` : "Decoded"}</b></summary>
    <p class="preview-sentence">${esc(preview.sentence)}</p>
    ${
      preview.flags.length
        ? `<ul class="preview-flags">${preview.flags
            .map(
              (entry) =>
                `<li class="${entry.level}"><b>${entry.level === "attention" ? "Check" : "Note"}</b><span>${esc(entry.text)}</span></li>`,
            )
            .join("")}</ul>`
        : ""
    }
    <div class="preview-raw"><div class="section-label">Raw transaction</div>${preview.rows
      .map(
        (row) =>
          `<div class="pair preview-row"><span>${esc(row.label)}</span><b>${esc(row.value)}</b></div>`,
      )
      .join("")}</div>
    <p class="micro">Decoded in this page from the calldata itself. The sentence above never says more than the payload proves.</p>
  </details>`;
}
// The approval boundary: every stage that runs when this action is approved,
// with the single line where authority stops being Tera's and becomes yours.
function boundaryBlock(proposal, index) {
  const intent = proposal.intent || proposal.preparedTransaction?.intent;
  if (!proposal.preparedTransaction || !intent) return "";
  const live = state.approval?.index === index ? state.approval : null;
  const stages =
    live?.stages ||
    stagesFor({
      nativeTransfer: intent.assetAddress === ZERO_ADDRESS,
      steps: 1 + (proposal.preparedTransaction.approvals?.length || 0),
    });
  const progress = live?.progress || initialProgress(stages);
  const summary = progressSummary(progress, stages);
  const crossAt = boundaryIndex(stages);
  const signatures = 1 + (proposal.preparedTransaction.approvals?.length || 0);
  const mark = {
    pending: "·",
    running: "▶",
    done: "✓",
    failed: "✕",
    skipped: "—",
  };
  return `<details class="boundary" ${live ? "open" : ""}>
    <summary><span>Where your authority begins</span><b>${esc(summary.crossed ? "Crossed" : "Not crossed")}</b></summary>
    <p class="micro">${esc(summary.text)}</p>
    ${signatures > 1 ? `<p class="micro">This action needs ${signatures} signatures: an allowance first, then the action itself. The boundary is crossed once for each.</p>` : ""}
    <div class="boundary-side"><b>${esc(SIDE_NOTES.prepared.title)}</b><small>${esc(SIDE_NOTES.prepared.note)}</small></div>
    <ol class="boundary-stages">
      ${stages
        .map((stage, i) => {
          const status = progress[stage.id] || "pending";
          return `${i === crossAt ? `<li class="boundary-line" aria-hidden="false"><span>Authority moves here</span></li><li class="boundary-side-note"><b>${esc(SIDE_NOTES.owner.title)}</b><small>${esc(SIDE_NOTES.owner.note)}</small></li>` : ""}
          <li class="stage ${stage.side} ${status}"><span class="stage-mark" aria-hidden="true">${mark[status] || "·"}</span><span class="stage-body"><b>${esc(stage.label)}</b><small>${esc(stage.detail)}</small></span><em>${esc(status.toUpperCase())}</em></li>`;
        })
        .join("")}
    </ol>
  </details>`;
}
// A local, owner-only record of how this action changed between preparations.
function historyBlock(proposal) {
  const lineage = proposal?.lineage;
  const stored = lineage ? state.versions[lineage] : null;
  if (!stored?.length) return "";
  const intent = proposal.intent || proposal.preparedTransaction?.intent || {};
  const trail = versionTrail(stored, snapshot(proposal, assetFor(intent.assetAddress)));
  const when = (at) => new Date(at).toLocaleString();
  return `<details class="version-history">
    <summary><span>Version history</span><b>${trail.length} versions</b></summary>
    <p class="micro">Kept on this device in your encrypted vault. No version of this proposal is sent anywhere.</p>
    ${trail
      .map(
        (entry) => `<article class="version-entry">
        <div class="version-top"><b>${esc(entry.label)}</b><time>${esc(when(entry.version.at))}</time></div>
        ${pair("Amount", formatAmount(entry.version))}${entry.version.recipient ? pair("Recipient", entry.version.recipient) : ""}${pair("Decision", entry.version.decision)}
        ${
          entry.changes.length
            ? `<ul class="version-diff">${entry.changes
                .map(
                  (change) =>
                    `<li><span>${esc(change.label)}</span><span class="from">${esc(change.from)}</span><span class="arrow">→</span><span class="to">${esc(change.to)}</span>${change.note ? `<em>${esc(change.note)}</em>` : ""}</li>`,
                )
                .join("")}</ul>`
            : entry.index === 0
              ? '<p class="micro">First version prepared.</p>'
              : '<p class="micro">No tracked field changed.</p>'
        }
      </article>`,
      )
      .join("")}
    <div class="actions">${button("Forget this history", "history-clear", `data-lineage="${esc(lineage)}"`)}</div>
  </details>`;
}
function newLineage() {
  return `lineage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
// Keep the version the owner is replacing, so the change is visible afterwards.
function recordVersion(lineage, proposal) {
  const intent = proposal?.intent || proposal?.preparedTransaction?.intent || {};
  state.versions[lineage] = appendVersion(
    state.versions[lineage],
    snapshot(proposal, assetFor(intent.assetAddress)),
  );
}
// The five checks are the service's account of the action. This block is the
// wallet's own: comparisons it performs locally, which hold even if the service
// is wrong or dishonest.
function localBlock(proposal) {
  const rows = localChecks(proposal, state.owner, chainId);
  if (!rows.length) return "";
  const summary = localSummary(rows);
  return `<details class="local-verify ${summary.passed ? "" : "failed"}">
    <summary><span>Verified by this wallet</span><b>${rows.filter((row) => row.passed).length}/${rows.length} match</b></summary>
    <p class="micro">${esc(summary.text)}</p>
    <ul class="local-list">${rows
      .map(
        (row) =>
          `<li class="${row.passed ? "" : "blocked"}"><span>${esc(row.label)}<small>${esc(row.detail)}</small></span><b>${row.passed ? "MATCH" : "MISMATCH"}</b></li>`,
      )
      .join("")}</ul>
    <p class="micro">These comparisons run in your browser against the action you reviewed. They do not ask Tera whether the transaction is correct.</p>
  </details>`;
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
      const detail = explainGate(name, g);
      const status = i === 4 && g?.passed ? "AWAITING SIGNATURE" : detail.result;
      return `<li class="${g?.passed === false ? "blocked" : ""}"><details class="gate-detail"><summary><span class="audit-num">0${i + 1}</span><span class="gate-name">${esc(detail.label)}${g?.reason ? `<small>${esc(g.reason)}</small>` : ""}</span><b>${status}</b></summary>
        <div class="gate-body">
          ${pair("Rule evaluated", detail.rule)}${pair("Evaluated by", detail.evaluatedBy)}${pair("Inputs it received", detail.inputs.join(" · "))}${pair("Withheld from the assistant", detail.withheld.join(" · "))}
          ${detail.nuance ? `<p class="micro gate-nuance">${esc(detail.nuance)}</p>` : ""}
          <p class="micro">${esc(detail.meaning)}</p>
        </div></details></li>`;
    }).join("")}</ul>
    ${localBlock(p)}
    ${previewBlock(p)}
    ${historyBlock(p)}
    ${boundaryBlock(p, index)}
    ${pair(intent?.actionType === "BUY" ? "USDG input" : "Amount reported by service", amount)}${intent?.actionType === "BUY" || intent?.actionType === "SELL" ? pair("Quoted output", (p.quote || p.preparedTransaction?.quote)?.amountOut ? `${esc((p.quote || p.preparedTransaction.quote).amountOut)} · ${esc((p.quote || p.preparedTransaction.quote).route || "live route")}` : "Quote unavailable") : ""}${intent?.policyVersion ? pair("Local policy", `Signed bundle v${intent.policyVersion}`) : ""}${intent?.recipient ? pair("Recipient", intent.recipient) : ""}${p.preparedTransaction ? pair("Transaction target", p.preparedTransaction.to) : ""}
    ${submitted ? `<p>Transaction: ${explorer(p.txHash)}</p>` : issue ? `<p class="live-blocked">${esc(issue)}</p>` : '<p class="micro">Review the token amount and recipient. Your wallet will ask you to sign and pay the network fee.</p>'}
    <div class="actions">${button("Approve in wallet ↗", "approve", `data-index="${index}" ${issue || submitted || state.busy || state.chain !== chainId ? "disabled" : ""}`)}${button("Prepare again", "reprepare", `data-index="${index}" ${state.busy || submitted || !intent ? "disabled" : ""}`)}${button("Share redacted", "share", `data-index="${index}"`)}${button("Dismiss", "draft-dismiss", `data-index="${index}" ${state.busy ? "disabled" : ""}`)}</div></article>`;
}
function approvals() {
  return `<div class="toolbar">${button("+ New proposal", "create")}${chip("Review before signing")}</div>${state.drafts.map(proposalCard).join("") || empty("No proposals in this session. Create a new proposal to run the checks.")}<p class="micro">Quote-based proposals may expire when the backend supplies an expiry. Transfers remain reviewable until you dismiss them. Pending transactions remain in Receipts.</p>`;
}
function policy() {
  const bundle = state.policyBundle;
  const bundlePanel = !bundle
    ? `<section class="panel"><div class="eyebrow">Local policy</div><h2>Loading signed policy bundle…</h2>${state.policyError ? `<p class="live-blocked">${esc(state.policyError)}</p>` : ""}<div class="actions">${button("Refresh policy", "policy-refresh")}</div></section>`
    : `<section class="panel"><div class="eyebrow">Local policy ${chip("Signed and active")}</div><h2>Rules run in this wallet before preparation.</h2>${pair("Bundle version", `v${bundle.version}`)}${pair("Signer", short(bundle.signer))}${pair("Expires", new Date(bundle.expiresAt).toLocaleString())}${pair("Single-trade cap", `$${(bundle.rules.maxSingleTradeUsdCents / 100).toLocaleString()}`)}${pair("Allowed actions", bundle.rules.allowedActions.join(", "))}<p class="micro">The browser recovered the signing address from the bundle signature before applying these rules. Tera evaluates the same rules again server-side.</p><div class="actions">${button("Refresh policy", "policy-refresh")}</div></section>`;
  const assets = state.assets.filter((a) => isAddress(a.address));
  const result = state.simulation;
  return `<div class="content-grid">${bundlePanel}<aside class="panel"><h2>Your approval remains required.</h2><p>Local policy can block a proposal early. Only you can approve a transaction in your wallet.</p><a class="btn" href="${href("approvals")}">Review proposals ↗</a></aside></div>
  <div class="section-label simulator-heading"><span>Policy simulator</span>${chip("Nothing is sent")}</div>
  <div class="content-grid">
    <section class="panel">
      <h2>Test an action before you propose it.</h2>
      <p class="micro">This runs entirely in your browser against the signed bundle and your own presets. No proposal is created, nothing is sent to Tera, and no signature is requested.</p>
      <form id="simulator-form">
        <div class="field"><label for="sim-asset">Asset</label><select id="sim-asset" name="asset">${assets.map((a) => `<option value="${esc(a.symbol)}">${esc(a.symbol)} · ${esc(a.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="sim-action">Action</label><select id="sim-action" name="action">${ACTIONS.map((action) => `<option>${esc(action)}</option>`).join("")}</select></div>
        <div class="field"><label for="sim-amount">Amount</label><input id="sim-amount" name="amount" inputmode="decimal" placeholder="0.00" pattern="[0-9]+(\\.[0-9]+)?" required></div>
        <div class="field"><label for="sim-recipient">Recipient (optional)</label><input id="sim-recipient" name="recipient" placeholder="0x…" autocomplete="off"></div>
        <p class="live-form-error" role="alert"></p>
        <button class="btn primary">Simulate locally ↗</button>
      </form>
      ${
        result
          ? `<div class="sim-result ${result.passed ? "" : "blocked"}" role="status">
              <div class="proposal-top"><b>${result.passed ? "Would be allowed" : "Would be blocked"}</b>${chip(result.passed ? "No rule blocks it" : `Blocked by ${esc(result.blockedBy.rule)}`, !result.passed)}</div>
              <p class="micro">${esc(result.summary)}</p>
              <ul class="sim-rules">${result.rows
                .map(
                  (row) =>
                    `<li class="${row.passed ? "" : "blocked"}"><span class="sim-scope">${esc(row.scope)}</span><span class="sim-rule"><b>${esc(row.rule)}</b><small>${esc(row.detail)}</small></span><em>${row.passed ? "ALLOWS" : "BLOCKS"}</em></li>`,
                )
                .join("")}</ul>
            </div>`
          : ""
      }
    </section>
    <aside class="panel">
      <div class="section-label"><span>Your presets</span>${button("+ Add preset", "preset-new")}</div>
      <p class="micro">Named limits kept in your encrypted vault on this device. They are never uploaded, and Tera cannot read or enforce them — they run here, before a proposal exists.</p>
      ${
        state.presets.length
          ? state.presets
              .map(
                (preset) => `<article class="preset ${preset.enabled ? "" : "off"}">
          <div class="proposal-top"><b>${esc(preset.name)}</b>${chip(preset.enabled ? "Active" : "Paused", !preset.enabled)}</div>
          <p class="micro">${esc(presetSummary(preset))}</p>
          <div class="actions">${button(preset.enabled ? "Pause" : "Activate", "preset-toggle", `data-id="${esc(preset.id)}"`)}${button("Delete", "preset-delete", `data-id="${esc(preset.id)}"`)}</div>
        </article>`,
              )
              .join("")
          : empty("No presets yet. Add one to test actions against your own limits.")
      }
    </aside>
  </div>`;
}

function sessions() {
  if (!state.owner) return accountPrompt();
  const sessionCard = (s) => {
    const key = s.session_key_address || s.sessionKeyAddress;
    const expiry = s.expires_at || s.expiresAt;
    const scope = s.scope || {};
    const inactive = s.is_revoked || s.isRevoked || Date.parse(expiry) <= Date.now();
    const serviceSession = scope.kind === "service";
    return `<article class="panel live-session">${pair(serviceSession ? "Session ID" : "Session key", key)}${pair("Expires", new Date(expiry).toLocaleString())}${pair("Actions", Array.isArray(scope.allowedActions) ? scope.allowedActions.join(", ") : "On-chain scope")}${pair("Assets", Array.isArray(scope.assetAddresses) ? scope.assetAddresses.map(short).join(", ") : "On-chain scope")}${chip(s.is_revoked || s.isRevoked ? "Revoked" : inactive ? "Expired" : serviceSession ? "Active service token" : "Registered")}<p class="micro">${serviceSession ? "This token scopes Tera service requests only. Owner approval is still required for every transaction." : "On-chain authority has not been verified in this connected-wallet flow."}</p>${serviceSession && !inactive ? `<div class="actions">${button("Rotate token", "session-rotate", `data-session="${esc(key)}"`)}${button("Revoke now", "session-revoke", `data-session="${esc(key)}"`)}</div>` : ""}</article>`;
  };
  return `<div class="note">Service tokens are short-lived and limited to the action and asset you choose. They cannot sign or move funds; your wallet still approves every transaction.</div><div class="toolbar">${button("Create service token", "session-create")}</div>${state.errors.sessions ? empty(state.errors.sessions) : state.sessions.map(sessionCard).join("") || empty("No sessions returned for this wallet.")}`;
}

function showSessionToken(result, title = "Service token created") {
  const token = result.token;
  const session = result.session || {};
  dialog(
    title,
    `<p>Copy this token now. Tera stores only a hash and will not show the token again.</p>${pair("Expires", new Date(session.expires_at || session.expiresAt).toLocaleString())}<div class="field"><label for="service-token">Service token</label><input id="service-token" readonly value="${esc(token)}"></div><p class="micro">It is restricted to ${esc((session.scope?.allowedActions || []).join(", "))} and the selected asset. Rotate or revoke it from Agent sessions at any time.</p><div class="actions">${button("Copy token", "session-copy-token")}${button("Close", "close")}</div>`,
  );
}

function createServiceSession() {
  connected();
  const assets = state.assets.filter((asset) => isAddress(asset.address) && asset.status === "ACTIVE");
  if (!assets.length) throw new Error("Load the asset registry before creating a service token.");
  dialog(
    "Create a short-lived service token",
    `<form id="session-form"><div class="field"><label for="session-action">Allowed action</label><select id="session-action" name="action"><option>BUY</option><option>SELL</option><option>TRANSFER</option></select></div><div class="field"><label for="session-asset">Allowed asset</label><select id="session-asset" name="asset">${assets.map((asset) => `<option value="${esc(asset.address)}">${esc(asset.symbol)} · ${esc(asset.name)}</option>`).join("")}</select></div><div class="field"><label for="session-ttl">Expires after</label><select id="session-ttl" name="ttl"><option value="900">15 minutes</option><option value="3600">1 hour</option><option value="14400">4 hours</option><option value="86400">24 hours</option></select></div><div class="field"><label for="session-label">Label (optional)</label><input id="session-label" name="label" maxlength="80" placeholder="Example: research assistant"></div><p class="micro">The token can prepare only this kind of service request for this asset. It cannot approve or sign a transaction.</p><p class="live-form-error" role="alert"></p><button class="btn primary">Create token ↗</button></form>`,
  );
  const form = document.getElementById("session-form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button");
    submit.disabled = true;
    try {
      const data = new FormData(form);
      const result = await api("/api/session/issue", {
        accountAddress: state.owner,
        allowedActions: [data.get("action")],
        assetAddresses: [data.get("asset")],
        ttlSeconds: Number(data.get("ttl")),
        label: data.get("label").trim(),
      });
      showSessionToken(result);
      await refreshAccount();
    } catch (error) {
      form.querySelector('[role="alert"]').textContent = errorMessage(error);
    } finally {
      submit.disabled = false;
    }
  };
}
function receipts() {
  if (!state.owner) return accountPrompt();
  return `<div class="section-label">Transactions tracked on this device</div>${state.records.map((r, i) => `<article class="panel live-record"><div class="proposal-top"><b>${esc(r.action || "Transaction")}</b>${chip(r.status === "confirmed" ? (r.recorded ? "Confirmed · recorded" : "Confirmed · audit sync pending") : r.status, r.status === "reverted")}</div>${pair("Submitted", r.createdAt)}<p>${explorer(r.txHash)}</p>${r.error ? `<p class="micro">${esc(r.error)}</p>` : ""}<div class="actions">${r.status !== "reverted" && !r.recorded ? button("Check status / retry audit sync", "receipt-check", `data-index="${i}" ${state.busy ? "disabled" : ""}`) : ""}${button("Export receipt", "receipt-export", `data-index="${i}"`)}</div></article>`).join("") || empty("No transactions tracked on this device.")}
    <div class="section-label live-history-heading">Account history from Tera</div>${state.errors.history ? empty(state.errors.history) : `<div class="table-scroll"><table><thead><tr><th>Action</th><th>Service status</th><th>Created</th><th>Transaction</th></tr></thead><tbody>${state.history.map((r) => `<tr><td>${esc(r.intent_type || r.intent?.actionType || "—")}</td><td>${esc(r.status)}</td><td>${esc(r.created_at || r.createdAt)}</td><td>${r.tx_hash ? explorer(r.tx_hash) : "—"}</td></tr>`).join("")}</tbody></table>${state.history.length ? "" : empty("No history returned by the service.")}</div>`}`;
}
// The egress panel is derived once so the view and the export can never
// disagree about who was contacted.
function egressRows() {
  return egressStatus(
    parties({
      apiUrl,
      rpcUrl: config.rpcUrl,
      explorerUrl: config.explorerUrl,
      chainId,
      siteHost: location.host,
    }),
    {
      log: state.privacyLog,
      owner: state.owner,
      demo: state.demo,
      records: state.records.length,
    },
  );
}
function privacyCentre() {
  const totals = summarize(state.privacyLog);
  const egress = egressRows();
  const reachTotals = egressSummary(egress);
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
      <div class="metric"><strong>${totals.replaced}</strong><small>Values replaced on this device before sending</small></div>
      <div class="metric"><strong>${reachTotals.seeingYouNow}</strong><small>Parties in a position to see you right now</small></div>
      <div class="metric"><strong>${totals.fields}</strong><small>Distinct fields sent</small></div>
    </div>
    <div class="note"><strong>Prompt minimisation</strong>${state.minimise ? "Assistant messages are scrubbed on this device before they are sent: addresses, references, contact details and figures are replaced with placeholders, and the reply is re-hydrated here. A proposal keeps the recipient and the figure, because Tera reads those out of the text to build the transaction." : "Prompt minimisation is off, so assistant messages are sent exactly as you type them."} It removes the values from the text. It does not hide that you are asking, and it does not hide the network address the request comes from.</div>
    <div class="note"><strong>Data boundary</strong>Requests go to ${esc(serviceHost)}. Balances and receipts are read directly through your wallet's network provider, so Tera does not see them. The log below records field names only — never an address, an amount or the text you typed. Tera is not the only party involved: the panel further down names every other one.</div>
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
              <div class="proposal-top"><b>${esc(entry.label)}</b><span class="actions">${entry.simulated ? chip("Simulated · not sent") : ""}${entry.minimised ? chip(`${entry.replaced} replaced locally`) : ""}${chip(addressChip(entry), entry.identifies)}</span></div>
              <p class="micro">${esc(entry.purpose)}</p>
              ${pair("Sent", list(entry.sent, "No owner data"))}${entry.minimised ? pair("Minimised before sending", `${entry.replaced} ${entry.replaced === 1 ? "value" : "values"} replaced with placeholders`) : ""}${pair("Request", `${entry.method} ${entry.path}`)}${pair("Goes to", entry.processors.join(" · "))}${pair("Withheld", list(entry.withheld, "Not documented"))}${pair("Recorded at", time(entry.at))}
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
    <div class="section-label privacy-catalogue-heading">Who else can see you<span class="micro">${reachTotals.seeingYouNow} of ${reachTotals.parties} parties involved right now</span></div>
    <div class="note"><strong>Two different things</strong>A party that <b>connects to you</b> sees the network address you are on. A party that <b>receives your data through Tera</b> sees Tera's server address instead — it still gets the data, it just does not get you. The rows below say which, for each one.</div>
    <div class="egress-grid">${egress
      .map(
        (party) => `<article class="panel egress-party ${party.seesYouNow ? "live" : ""}">
          <div class="proposal-top"><b>${esc(party.name)}</b><span class="actions">${chip(REACH[party.reach].label, party.reach === "direct" || party.reach === "wallet")}${party.uncounted ? chip("Not counted here") : ""}</span></div>
          <p class="micro egress-host">${esc(party.host)}</p>
          <div class="section-label egress-label">What it learns</div>
          <ul class="egress-list">${party.learns.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
          <div class="section-label egress-label">What it does not get</div>
          <p class="micro">${party.withheld.map((line) => esc(line)).join(" · ")}</p>
          ${pair("This session", party.note)}
          <p class="micro">${esc(REACH[party.reach].detail)}</p>
          <p class="micro egress-control"><b>Your move:</b> ${esc(party.control)}</p>
        </article>`,
      )
      .join("")}</div>
    <p class="micro">${reachTotals.uncounted} of these cannot be counted from this page. Your wallet extension opens its own connections and this page never sees them, so those rows describe what that party is in a position to learn, not a measurement. Nothing here covers traffic from other tabs, other extensions, or your network operator.</p>
    <div class="section-label privacy-catalogue-heading">Every request this wallet can make</div>
    <div class="table-scroll"><table><thead><tr><th>Request</th><th>Fields sent</th><th>Goes to</th><th>Retention</th></tr></thead><tbody>${REQUESTS.map(
      (entry) =>
        `<tr><td><b>${esc(entry.label)}</b><small>${esc(entry.method)} ${esc(entry.path)}</small></td><td class="privacy-wrap">${list(entry.fields, "No owner data")}</td><td class="privacy-wrap">${esc(entry.processors.join(" · "))}</td><td class="privacy-wrap">${esc(entry.retention)}</td></tr>`,
    ).join("")}</tbody></table></div>
    <p class="micro">Retention is described by the service and cannot be verified from this page. Deleting service-side records is not available yet; clearing the log above removes only this local copy.</p>`;
}

function settings() {
  return `<div class="content-grid"><section class="panel"><h2>Wallet connection</h2>${pair("Account", state.owner || "Not connected")}${pair("Network ID", chainId)}${pair("Wallet network", state.chain || "Not connected")}<div class="actions">${button(state.owner ? "Disconnect" : "Connect wallet", state.owner ? "disconnect" : "connect")}${button(state.hide ? "Show balances" : "Hide balances", "privacy")}</div></section><aside class="panel"><h2>Encrypted local storage</h2><p>${state.vaultKey ? "Drafts and device-side transaction records are encrypted in this browser." : "Unlock with a wallet signature to read and save encrypted drafts and device-side transaction records."}</p>${pair("Retention", `${state.vaultRetentionDays} days`)}<div class="field"><label for="vault-retention">Keep encrypted data for</label><select id="vault-retention" ${!state.owner ? "disabled" : ""}>${[7, 30, 90, 365].map((days) => `<option value="${days}" ${state.vaultRetentionDays === days ? "selected" : ""}>${days} days</option>`).join("")}</select></div><p class="micro">Unlocking signs a local storage message only. It does not approve a transaction or send a key to Tera.</p><div class="actions">${button(state.vaultKey ? "Vault unlocked" : "Unlock encrypted vault", "vault-unlock", !state.owner || state.vaultKey ? "disabled" : "")}${button("Clear encrypted data", "vault-clear", !state.owner ? "disabled" : "")}</div></aside><aside class="panel"><h2>Data retention</h2><p>Delete assistant messages, drafts, proposal versions, presets, and local request metadata. Confirmed transaction receipts stay available for audit history.</p><div class="actions">${button("Delete local assistant data", "assistant-local-clear", !state.owner ? "disabled" : "")}${button("Delete stored assistant data", "assistant-server-clear", !state.owner ? "disabled" : "")}</div></aside><aside class="panel"><h2>Guided private demo</h2><p>Run the wallet on sample data to show the privacy boundary without a real account. No request leaves the page and no transaction can be signed.</p><div class="actions">${state.demo ? button("Reset demo", "demo-reset") + button("Exit demo", "demo-exit") : button("Start guided demo", "demo-start")}</div></aside></div>`;
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
  state.bridges = [];
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
  state.vaultKey = null;
  state.agentSessionToken = "";
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
async function prepareWithLocalPolicy(intent) {
  const bundle = await loadPolicyBundle();
  const issue = evaluateLocalPolicy(intent, bundle, config.policySignerAddress || bundle.signer);
  if (issue) throw new Error(issue);
  return {
    ...intent,
    policyVersion: bundle.version,
    policySigner: bundle.signer,
    policySignature: bundle.signature,
  };
}
async function loadPolicyBundle(force = false) {
  if (state.policyBundle && !force && Date.parse(state.policyBundle.expiresAt) > Date.now())
    return state.policyBundle;
  const url = config.policyBundleUrl || `${apiUrl.replace(/\/$/, "")}/policy-bundle.json`;
  state.privacyLog = appendLog(state.privacyLog, describeRequest("/policy-bundle.json"));
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("Cannot load the signed local policy bundle.");
  }
  if (!response.ok) throw new Error("The signed local policy bundle is unavailable.");
  const bundle = await response.json();
  const signer = config.policySignerAddress || bundle.signer;
  if (!(await verifyPolicyBundle(bundle, signer)))
    throw new Error("The signed local policy bundle failed signature verification.");
  state.policyBundle = bundle;
  state.policyError = "";
  return bundle;
}

// `lineage` carries a re-prepared action's history forward; a fresh proposal
// starts its own.
async function prepare(intent, lineage = "") {
  connected();
  if (state.busy) throw new Error("Wait for the current request to finish.");
  const version = generation;
  state.busy = true;
  try {
    const locallyApprovedIntent = await prepareWithLocalPolicy(intent);
    let result;
    try {
      result = await api("/api/intent/prepare", locallyApprovedIntent);
    } catch (error) {
      if (!error.payload?.gates) throw error;
      result = error.payload;
    }
    if (version !== generation) throw new Error("Your wallet changed. Prepare a new proposal.");
    // Keep the owner's requested intent for calldata comparison, never replace it
    // with a service-supplied owner, recipient or amount.
    state.drafts.unshift({
      ...result,
      intent: locallyApprovedIntent,
      preparedAt: Date.now(),
      lineage: lineage || newLineage(),
    });
    void persist();
  } finally {
    state.busy = false;
    render();
  }
}

async function refreshBridge(record) {
  if (!record) return;
  const version = generation;
  try {
    const { status } = await api(`/api/bridge/status/${record.requestId}`);
    if (version !== generation) return;
    if (status.originChainId && status.originChainId !== 4663) throw new Error("Unexpected bridge origin.");
    if (status.destinationChainId && status.destinationChainId !== record.destinationChainId) throw new Error("Unexpected bridge destination.");
    record.status = status.status;
    record.destinationHashes = Array.isArray(status.txHashes) ? status.txHashes : [];
    record.error = status.failReason && status.failReason !== "N/A" ? status.failReason : "";
  } catch (error) { if (version === generation) record.error = errorMessage(error); }
  if (version === generation) { await persist(); render(); }
}

function reviewBridge(quote, input, version) {
  const fee = entry => entry?.currency ? `${formatUnits(entry.amount, entry.currency.decimals)} ${entry.currency.symbol}` : "Unavailable";
  const sourceEth = input.originCurrency === "0x0000000000000000000000000000000000000000";
  const sourceSymbol = sourceEth ? "ETH" : "USDG";
  const sourceDecimals = sourceEth ? 18 : 6;
  const outSymbol = quote.input?.destination?.symbol || "destination token";
  const outDecimals = quote.input?.destination?.decimals ?? 6;
  const panel = dialog("Review your bridge", `${pair("From", `Robinhood Chain · ${sourceSymbol}`)}${pair("To", `${quote.input?.destination?.name || "Destination"} · ${outSymbol}`)}${pair("Receiving address", input.recipient)}${pair(`${sourceSymbol} input`, formatUnits(input.amount, sourceDecimals))}${pair(`Expected ${outSymbol}`, formatUnits(quote.amountOut, outDecimals))}${pair(`Minimum ${outSymbol}`, formatUnits(quote.minimumAmountOut, outDecimals))}${pair("Relay fee (included in quote)", fee(quote.fees?.relayer))}${pair("Estimated network fee (additional)", fee(quote.fees?.gas))}${pair("Quote expires", new Date(quote.expiresAt).toLocaleTimeString())}<p class="micro">Relay handles delivery to this address. Source confirmation alone does not mean delivery is complete. Delivery or refund progress will appear below. ${state.vaultKey ? "Tracking is saved in your encrypted vault." : "Unlock the vault in Settings to save tracking across reloads."}</p><p id="bridge-progress" role="status"></p><button class="btn" id="bridge-sign">Approve bridge in wallet ↗</button>`);
  const sign = panel.querySelector("#bridge-sign");
  sign.onclick = async () => {
    if (state.busy) return;
    sign.disabled = true;
    state.busy = true;
    let record;
    const progress = message => { panel.querySelector("#bridge-progress").textContent = message; };
    const active = () => {
      if (version !== generation || !panel.open) throw new Error("Wallet or review changed. Request a fresh bridge quote.");
    };
    try {
      active();
      correctNetwork();
      await sendBridge(state.provider, quote, input, active, async (step, hash) => {
        // Capture submitted hashes before any subsequent network operation.
        if (version !== generation) {
          progress(`Transaction submitted: ${hash}. Track Relay reference ${quote.requestId}.`);
          throw new Error(`Wallet changed after submission. Relay reference: ${quote.requestId}; transaction: ${hash}`);
        }
        if (!record) {
          record = { ...input, requestId: quote.requestId, status: "waiting", createdAt: new Date().toISOString() };
          state.bridges.unshift(record);
        }
        if (step === "deposit") { record.depositHash = hash; record.status = "depositing"; }
        else record.approvalHash = hash;
        await persist();
      }, progress);
      progress("Deposit submitted. Tracking destination delivery.");
      await refreshBridge(record);
    } catch (error) {
      progress(`${errorMessage(error)} Request a fresh quote only if no deposit was submitted.`);
      if (record) { record.error = errorMessage(error); await persist(); }
    } finally { state.busy = false; render(); }
  };
}

setInterval(() => {
  if (route() !== "bridge" || state.busy || document.hidden) return;
  const record = state.bridges.find(r => r.depositHash && !["success", "failure", "refund"].includes(r.status));
  if (record && !polling) {
    polling = true;
    void refreshBridge(record).finally(() => { polling = false; });
  }
}, 10000);

function bindForms() {
  const bridgeForm = document.getElementById("bridge-form");
  if (bridgeForm) bridgeForm.onsubmit = async (event) => {
    event.preventDefault();
    if (state.busy || state.demo) return;
    const version = generation;
    const submit = bridgeForm.querySelector("button");
    submit.disabled = true;
    try {
      correctNetwork();
      const input = bridgeFormInput(bridgeForm, state.owner);
      const { quote } = await api("/api/bridge/quote", input);
      if (version !== generation) return;
      checkBridgeQuote(quote, input);
      reviewBridge(quote, input, version);
    } catch (error) {
      bridgeForm.querySelector('[role="alert"]').textContent = errorMessage(error);
    } finally { submit.disabled = false; }
  };
  const bridgeChain = document.getElementById("bridge-chain");
  const bridgeToken = document.getElementById("bridge-token");
  if (bridgeChain && bridgeToken) bridgeChain.onchange = () => {
    const sol = bridgeChain.value === "792703809";
    bridgeToken.innerHTML = sol
      ? '<option value="11111111111111111111111111111111">SOL</option><option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v">USDC</option><option value="Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB">USDT</option>'
      : bridgeChain.value === "5042"
        ? '<option value="0x3600000000000000000000000000000000000000">USDC</option>'
      : '<option value="0x0000000000000000000000000000000000000000">ETH</option><option value="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913">USDC</option>';
  };
  const filter = document.getElementById("asset-filter");
  if (filter)
    filter.onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(filter);
      state.query = data.get("query");
      state.category = data.get("category");
      render();
    };
  const simulator = document.getElementById("simulator-form");
  if (simulator)
    simulator.onsubmit = (event) => {
      event.preventDefault();
      const error = simulator.querySelector('[role="alert"]');
      try {
        const data = new FormData(simulator);
        const asset = state.assets.find((a) => a.symbol === data.get("asset"));
        if (!asset) throw new Error("Select an asset to simulate.");
        const recipient = String(data.get("recipient") || "").trim();
        if (recipient && !isAddress(recipient))
          throw new Error("Enter a valid recipient address, or leave it blank.");
        const amount = parseUnits(String(data.get("amount")).trim(), asset.decimals);
        const actionType = data.get("action");
        // Mirrors what a proposal would declare, without preparing one.
        const action = {
          actionType,
          assetSymbol: asset.symbol,
          assetAddress: asset.address,
          amount,
          recipient,
          ...(actionType === "BUY"
            ? { maxSpendUsdCents: Number(parseUnits(String(data.get("amount")).trim(), 2)) }
            : {}),
        };
        state.simulation = simulate({
          action,
          presets: state.presets,
          asset,
          bundle: state.policyBundle,
          bundleIssue: state.policyBundle
            ? evaluateLocalPolicy(
                { actionType, maxSpendUsdCents: action.maxSpendUsdCents },
                state.policyBundle,
                config.policySignerAddress || state.policyBundle.signer,
              )
            : null,
        });
        error.textContent = "";
        render();
      } catch (issue) {
        error.textContent = errorMessage(issue);
      }
    };
  const form = document.getElementById("chat-form");
  if (form)
    form.onsubmit = (event) => {
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
      const plan = planMessage(message, mode);
      // The side-by-side review is the point of the feature: the owner sees the
      // skeleton before it is sent, not after.
      if (plan.minimised && plan.result.placeholders.length && state.minimiseReview) {
        reviewMessage(plan);
        return;
      }
      void sendMessage(plan);
    };
}

// What leaves the device is decided here, once, for both modes. A proposal
// keeps the recipient and the figure because Tera reads them out of the text to
// build the transaction; a question keeps nothing.
function planMessage(message, mode) {
  const keep = mode === "propose" ? PROPOSE_KEEP : [];
  return {
    message,
    mode,
    keep,
    minimised: state.minimise,
    result: minimise(message, { owner: state.owner, keep }),
  };
}

let pendingMessage = null;
function reviewMessage(plan) {
  pendingMessage = plan;
  const { result, keep } = plan;
  const kept = keptKinds(result);
  dialog(
    "This is what leaves your device.",
    `<p>Your message stays here. The skeleton on the right is what is sent to ${esc(serviceHost)} and on to the model provider. The reply is re-hydrated on this device, so you read your own values back.</p>
     <div class="minimise-columns">
       <section><div class="section-label">What you typed</div><div class="share-preview"><pre>${minimiseSegments(result.typed)}</pre></div></section>
       <section><div class="section-label">What leaves this device</div><div class="share-preview"><pre>${minimiseSegments(result.sent)}</pre></div></section>
     </div>
     <div class="minimise-legend">${minimiseSummary(result)
       .map((line) => chip(`${line} replaced`))
       .join("")}${kept.map((kind) => chip(`${KIND_LABELS[kind]} kept`, true)).join("")}</div>
     ${kept.length ? `<p class="micro">Kept as typed because Tera reads them out of this text to build the transaction you review: ${esc(kept.map((kind) => KIND_LABELS[kind].toLowerCase()).join(", "))}. A question keeps none of them.</p>` : ""}
     <label class="share-toggle"><input type="checkbox" data-action="minimise-review-toggle" ${state.minimiseReview ? "checked" : ""}> Show me this before every message</label>
     <p class="micro">Placeholders remove the values, not the context. The model still sees what you are asking, and can infer a great deal from it. ${keep.length ? "" : "Tera and the model provider also see the network address this request came from."}</p>
     <div class="actions">${button("Send minimised", "minimise-send")}${button("Send as typed", "minimise-send-raw")}${button("Cancel", "close")}</div>`,
  );
}

async function sendMessage(plan) {
  const { message, mode, keep, result } = plan;
  const minimised = plan.minimised && result.placeholders.length > 0;
  // Never send a skeleton that still carries what it claimed to remove.
  if (minimised) {
    const left = residual(result.skeleton, keep);
    if (left.length) {
      state.notice = `This message could not be minimised safely (${left.map((kind) => KIND_LABELS[kind].toLowerCase()).join(", ")} still present). Nothing was sent.`;
      render();
      return;
    }
  }
  const outgoing = minimised ? result.skeleton : message;
  const version = generation;
  // The chat entry keeps the placeholder names and never the values behind them.
  state.chat.push({
    role: "user",
    text: message,
    sent: outgoing,
    minimised,
    removed: minimised ? result.placeholders.map(({ token, kind }) => ({ token, kind })) : [],
    kept: minimised ? keptKinds(result) : [],
  });
  state.busy = true;
  render();
  try {
    let response;
    const privacy = minimised
      ? { minimised: true, replaced: result.placeholders.length }
      : undefined;
    try {
      response = await api(
        mode === "propose" ? "/api/agent/propose" : "/api/agent/chat",
        mode === "propose"
          ? {
              prompt: outgoing,
              ownerAddress: state.owner,
              ...(state.agentSessionToken ? { sessionToken: state.agentSessionToken } : {}),
            }
          : { message: outgoing },
        { privacy },
      );
    } catch (error) {
      if (!error.payload?.gates) throw error;
      response = error.payload;
    }
    if (version !== generation) return;
    const restore = (text) => (minimised ? rehydrate(text, result.placeholders) : text);
    state.chat.push({
      role: "assistant",
      text: restore(
        response.reply ||
          response.explanation ||
          response.error ||
          "Review the proposal in Approvals.",
      ),
    });
    if (mode === "propose") {
      // The explanation is shown beside the proposal too, so it is re-hydrated
      // for the same reason the reply is.
      if (response.explanation) response.explanation = restore(response.explanation);
      try {
        const locallyApprovedIntent = await prepareWithLocalPolicy(response.intent);
        response.intent = locallyApprovedIntent;
        if (response.preparedTransaction)
          response.preparedTransaction.intent = locallyApprovedIntent;
      } catch (error) {
        response.error = errorMessage(error);
      }
      // Agent proposals are reviewed here; manual preparation persists the
      // exact intent through the API before any executable approval.
      state.drafts.unshift({
        ...response,
        preparedAt: Date.now(),
        ...(response.error ? { error: response.error } : {}),
      });
      void persist();
    }
  } catch (error) {
    if (version === generation) state.chat.push({ role: "assistant", text: errorMessage(error) });
  } finally {
    state.busy = false;
    render();
  }
}

async function approve(index) {
  correctNetwork();
  if (state.busy) return;
  const proposal = state.drafts[index];
  if (!proposal || proposal.txHash) return;
  const provider = state.provider,
    owner = state.owner,
    version = generation;
  const stages = stagesFor({
    nativeTransfer: proposal.intent.assetAddress === ZERO_ADDRESS,
    steps: 1 + (proposal.preparedTransaction.approvals?.length || 0),
  });
  state.busy = true;
  state.approval = { index, progress: initialProgress(stages), stages };
  state.notice = "Running read-only checks. Your wallet has not been asked to sign.";
  render();
  try {
    const hash = await sendPrepared(
      provider,
      proposal,
      owner,
      chainId,
      () => {
        if (version !== generation) throw new Error("Your wallet changed. Review a new proposal.");
        state.notice = "Review and confirm the transaction in your wallet.";
        render();
      },
      (id, status, info) => {
        if (version !== generation || !state.approval) return;
        state.approval.progress = applyStage(state.approval.progress, id, status, info);
        render();
      },
    );
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
      void persist();
      state.notice = "Transaction submitted. Waiting for on-chain confirmation.";
      navigate("receipts");
    } else {
      state.notice = `Transaction submitted: ${hash}. Reconnect this wallet and unlock its encrypted vault to retain the local record.`;
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
    void persist();
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
// Held between renders of the share dialog so the reference toggle can rebuild
// the same preview without re-deriving which proposal was being shared.
const shareState = { index: -1, reference: false, document: null };
function shareProposal(index, includeReference = false) {
  const proposal = state.drafts[index];
  if (!proposal) return;
  const intent = proposal.intent || proposal.preparedTransaction?.intent || {};
  const asset = assetFor(intent.assetAddress);
  const document = redactProposal(proposal, asset, { includeReference, chainId });
  const found = leaks(document, intent);
  // Never show, copy or download a document that still carries owner data.
  if (found.length) {
    state.notice = `This proposal could not be redacted safely (${found.join(", ")}). Nothing was prepared for sharing.`;
    render();
    return;
  }
  Object.assign(shareState, { index, reference: includeReference, document });
  const exact =
    asset && Number.isInteger(asset.decimals)
      ? `${formatExact(intent.amount, asset.decimals)} ${asset.symbol}`
      : "the exact amount";
  dialog(
    "Share without revealing yourself.",
    `<p>This is exactly what leaves your device. The checks and the decision are kept; your addresses, ${esc(exact)} and the transaction calldata are not.</p>
     <div class="share-preview"><pre>${esc(toText(document))}</pre></div>
     <label class="share-toggle"><input type="checkbox" data-action="share-reference" ${shareState.reference ? "checked" : ""}> Include a short action reference</label>
     <p class="micro">The reference lets Tera match this document to the original proposal. Leave it off to share with someone who should not be able to.</p>
     <div class="actions">${button("Copy", "share-copy")}${button("Download .json", "share-download")}${button("Close", "close")}</div>`,
  );
}
async function copyShare() {
  if (!shareState.document) return;
  try {
    await navigator.clipboard.writeText(toText(shareState.document));
    state.notice = "Redacted proposal copied. Paste it wherever you need to.";
  } catch {
    state.notice = "This browser blocked the clipboard. Use Download instead.";
  }
  closeDialog();
  render();
}
function downloadShare() {
  if (!shareState.document) return;
  downloadJson(shareState.document, `tera-redacted-proposal-${Date.now()}.json`);
  closeDialog();
}
function exportPrivacyLog() {
  if (!state.privacyLog.length) return;
  downloadJson(
    { ...exportable(state.privacyLog, serviceHost), egress: exportableEgress(egressRows()) },
    `tera-privacy-log-${Date.now()}.json`,
  );
}
function newPreset() {
  const symbols = [...new Set(state.assets.map((a) => a.symbol))];
  dialog(
    "Add a personal limit.",
    `<form id="preset-form"><p class="micro">Kept encrypted on this device. Tera never receives it, so it cannot enforce it for you — the wallet applies it here, before a proposal is prepared.</p>
      <div class="field"><label for="preset-name">Name</label><input id="preset-name" name="name" required maxlength="60" placeholder="Daily operations"></div>
      <div class="field"><label for="preset-max">Maximum per action (optional)</label><input id="preset-max" name="max" inputmode="decimal" placeholder="500" pattern="[0-9]+(\\.[0-9]+)?"></div>
      <div class="field"><label for="preset-asset">Applies to asset</label><select id="preset-asset" name="asset"><option value="">Any asset</option>${symbols.map((symbol) => `<option>${esc(symbol)}</option>`).join("")}</select></div>
      <div class="field"><label for="preset-actions">Allowed actions (optional)</label><select id="preset-actions" name="actions" multiple size="4">${ACTIONS.map((action) => `<option>${esc(action)}</option>`).join("")}</select></div>
      <div class="field"><label for="preset-recipients">Allowed recipients (optional, one per line)</label><textarea id="preset-recipients" name="recipients" rows="3" placeholder="0x…"></textarea></div>
      <p class="live-form-error" role="alert"></p>
      <button class="btn primary">Save preset</button></form>`,
  );
  const form = document.getElementById("preset-form");
  form.onsubmit = (event) => {
    event.preventDefault();
    const error = form.querySelector('[role="alert"]');
    try {
      const data = new FormData(form);
      const recipients = String(data.get("recipients") || "")
        .split(/\s+/)
        .map((row) => row.trim())
        .filter(Boolean);
      const invalid = recipients.filter((address) => !isAddress(address));
      if (invalid.length) throw new Error("One or more recipient addresses are not valid.");
      const preset = createPreset({
        name: data.get("name"),
        maxPerAction: data.get("max"),
        assetSymbol: data.get("asset"),
        allowedActions: data.getAll("actions"),
        recipients,
      });
      state.presets = upsertPreset(state.presets, preset);
      state.simulation = null;
      void persist();
      closeDialog();
      render();
    } catch (issue) {
      error.textContent = errorMessage(issue);
    }
  };
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
    if (action === "policy-refresh") {
      state.policyError = "";
      await loadPolicyBundle(true);
      render();
    }
    if (action === "vault-unlock") {
      await unlockEncryptedStorage();
      state.notice = "Encrypted local storage unlocked.";
      render();
    }
    if (action === "vault-clear") {
      clearEncryptedStorage();
      state.notice = "Encrypted drafts and device-side records were cleared.";
      render();
    }
    if (action === "assistant-local-clear") {
      if (!window.confirm("Delete assistant messages, drafts, proposal versions, presets, and local request metadata from this device?")) return;
      clearLocalAssistantData();
      await persist();
      state.notice = "Local assistant data was deleted from this device.";
      render();
    }
    if (action === "assistant-server-clear") {
      if (!window.confirm("Sign a wallet request to delete stored unconfirmed assistant proposal data? Confirmed receipts remain.")) return;
      await deleteServerAssistantData();
      render();
    }
    if (action === "minimise-toggle") {
      state.minimise = target.checked;
      // Updated in place so the message being composed is not thrown away.
      const hint = document.getElementById("minimise-hint");
      if (hint) hint.textContent = minimiseHint();
    }
    if (action === "minimise-review-toggle") state.minimiseReview = target.checked;
    if (action === "minimise-send" || action === "minimise-send-raw") {
      const plan = pendingMessage;
      pendingMessage = null;
      closeDialog();
      if (plan) await sendMessage({ ...plan, minimised: action === "minimise-send" });
    }
    if (action === "agent-token-connect") connectAgentSessionToken();
    if (action === "agent-token-disconnect") {
      state.agentSessionToken = "";
      await persist();
      state.notice = "Scoped session token disconnected from assistant proposals.";
      render();
    }
    if (action === "session-create") createServiceSession();
    if (action === "session-copy-token") {
      const token = document.getElementById("service-token")?.value;
      if (!token) throw new Error("The session token is unavailable.");
      await navigator.clipboard.writeText(token);
      state.notice = "Service token copied. Store it somewhere secure; it will not be shown again.";
      closeDialog();
      render();
    }
    if (action === "session-revoke") {
      await api("/api/session/revoke", {
        accountAddress: state.owner,
        sessionKeyAddress: target.dataset.session,
      });
      state.notice = "Service token revoked immediately.";
      await refreshAccount();
    }
    if (action === "session-rotate") {
      const result = await api("/api/session/rotate", {
        accountAddress: state.owner,
        sessionKeyAddress: target.dataset.session,
      });
      showSessionToken(result, "Service token rotated");
      await refreshAccount();
    }
    if (action === "create" || action === "asset-propose") createProposal(target.dataset.symbol);
    if (action === "asset") inspectAsset(target.dataset.symbol);
    if (action === "draft-dismiss") {
      state.drafts.splice(index, 1);
      void persist();
      render();
    }
    if (action === "reprepare") {
      const p = state.drafts[index];
      if (p?.intent) {
        const lineage = p.lineage || newLineage();
        recordVersion(lineage, p);
        await prepare(p.intent, lineage);
        state.drafts = state.drafts.filter((d) => d !== p);
        void persist();
        render();
      }
    }
    if (action === "approve") await approve(index);
    if (action === "receipt-export") exportReceipt(index);
    if (action === "bridge-status") await refreshBridge(state.bridges[index]);
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
    if (action === "history-clear" && target.dataset.lineage) {
      delete state.versions[target.dataset.lineage];
      void persist();
      state.notice = "Version history for that proposal was deleted from this device.";
      render();
    }
    if (action === "preset-new") newPreset();
    if (action === "preset-toggle" && target.dataset.id) {
      const preset = state.presets.find((row) => row.id === target.dataset.id);
      if (preset) {
        state.presets = upsertPreset(state.presets, { ...preset, enabled: !preset.enabled });
        state.simulation = null;
        void persist();
        render();
      }
    }
    if (action === "preset-delete" && target.dataset.id) {
      state.presets = removePreset(state.presets, target.dataset.id);
      state.simulation = null;
      void persist();
      render();
    }
    if (action === "share") shareProposal(index);
    if (action === "share-copy") await copyShare();
    if (action === "share-download") downloadShare();
    if (action === "share-reference") shareProposal(shareState.index, !shareState.reference);
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
document.addEventListener("change", (event) => {
  if (event.target?.id !== "vault-retention") return;
  const days = Number(event.target.value);
  if (![7, 30, 90, 365].includes(days)) return;
  state.vaultRetentionDays = days;
  if (state.owner) localStorage.setItem(vaultSettingsKey(), String(days));
  void persist();
  render();
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
