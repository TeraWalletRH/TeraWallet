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
import {
  verifyPolicyBundle,
  verifyBuildManifest,
  recoverReceiptSigner,
} from "/tera/connect/policy-verify.js";
import {
  verifyManifest,
  badge as integrityBadge,
  summary as integritySummary,
} from "./integrity.js";
import {
  decryptVault,
  encryptVault,
  unlockVault,
  newKeyInfo,
  isKeyInfo,
  nextEpoch,
  scopeFor,
  requestSignature,
  deriveVaultKey,
} from "./vault.js";
import {
  exportBundle,
  importBundle,
  createRecovery,
  recoverFromShares,
  passphraseIssue,
} from "./recovery.js";
import {
  plan as wipePlan,
  wipe as wipeStorages,
  wipeCaches,
  LIMITS as WIPE_LIMITS,
} from "./wipe.js";
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
  createRpc,
  probeEndpoint,
  balanceReader,
  createPool,
  poolUrls,
  assignEndpoint,
  poolSummary,
  POOL_LIMITS,
  EndpointError,
  READ_METHODS,
} from "./endpoint.js";
import { parties, egressStatus, egressSummary, exportableEgress, REACH } from "./egress.js";
import { describeSubmission, SUBMISSION_LIMITS, WHY_FIXED } from "./submission.js";
import {
  minimise,
  rehydrate,
  residual,
  summary as minimiseSummary,
  keptKinds,
  KIND_LABELS,
  PROPOSE_KEEP,
} from "../core/minimise.js";
import {
  GATE_LABELS,
  GATE_EXPLANATIONS,
  explainGate,
  localChecks,
  localSummary,
} from "./checks.js";
import {
  PASS as VERDICT_PASS,
  UNVERIFIABLE as VERDICT_UNVERIFIABLE,
  gateVerdicts,
  summarise as summariseVerdicts,
} from "../core/verdict.js";
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
import { createOhttpFetcher, LIMITS as OHTTP_LIMITS } from "./ohttp.js";
import {
  DEVICE,
  SERVICE,
  ENGINES,
  LIMITS as ENGINE_LIMITS,
  WEIGHTS_LIMITS,
  capabilities as engineCapabilities,
  route as routeMessage,
  downloadPlan,
  attribution,
  buildTurn,
  screenReply,
} from "./engine.js";
import {
  ANSWER,
  NAVIGATE,
  COMPOSE,
  parse as parseMessage,
  respond as respondLocally,
} from "../core/parse.js";
import {
  inspect as inspectIngress,
  LIMITS as INGRESS_LIMITS,
  KINDS as INGRESS_KINDS,
} from "../core/ingress.js";
import {
  CODE as RECEIPT_CODE,
  DEVICE as RECEIPT_DEVICE,
  SERVICE as RECEIPT_SERVICE,
  ANSWERED_BY,
  CLAIMS as RECEIPT_CLAIMS,
  EXPORT_WARNING,
  exportNotice,
  create as createReceipt,
  bundle as receiptBundle,
  verify as verifyReceipt,
  tally as receiptTally,
  sign as signReceipt,
  DOMAIN,
} from "../core/receipt.js";
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
// Oblivious HTTP, for the routes the gateway is configured to accept.
//
// Prompt minimisation already strips the values out of an assistant message.
// What it cannot strip is the connection: Tera sees the address the message
// arrives from, and an address identifies an owner as well as a name does. A
// sealed request is encrypted to Tera's gateway key here and handed to a relay
// run by somebody else, so the relay has the address and no readable request,
// and Tera has the request and no address.
//
// Only the listed routes go this way, because only those are what the gateway
// accepts. Everything else still connects to Tera directly, and the egress panel
// says so rather than implying the whole page is covered.
const obliviousPaths = Array.isArray(config.ohttpPaths)
  ? config.ohttpPaths
  : ["/api/agent/chat", "/api/agent/propose"];
const oblivious = (() => {
  if (!config.ohttpRelayUrl) return null;
  try {
    const send = createOhttpFetcher({
      relayUrl: config.ohttpRelayUrl,
      keyConfigUrl:
        config.ohttpKeyConfigUrl || `${apiUrl.replace(/\/$/, "")}/.well-known/ohttp-gateway`,
      gatewayUrl: apiUrl,
    });
    return { send, host: new URL(config.ohttpRelayUrl).host, request: createApi(apiUrl, send) };
  } catch (error) {
    // A misconfigured relay must not silently fall back to a direct request that
    // the privacy panel would then describe as sealed. It is reported and left off.
    console.warn("Oblivious HTTP is not active:", errorMessage(error));
    return null;
  }
})();
const sealedPath = (path) => Boolean(oblivious) && obliviousPaths.includes(path.split("?")[0]);
const direct = createApi(apiUrl);
const request = (path, body, options) =>
  sealedPath(path) ? oblivious.request(path, body, options) : direct(path, body, options);
// Every service request is recorded for the privacy status centre before it is
// sent. Field names only: no address, amount or message text enters the log.
const api = async (path, body, options = {}) => {
  // `privacy` records what this device did to the body before it was built —
  // counts and flags only, never a value.
  const { privacy, ...rest } = options;
  const sealed = sealedPath(path);
  const entry = {
    ...describeRequest(path, body),
    ...privacy,
    ...(sealed ? { oblivious: true, relayHost: oblivious.host } : {}),
  };
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
// The on-device engine's side of the worker boundary.
//
// It is deliberately not part of `api`. Everything that goes through `api` is a
// request and is recorded as one; a turn answered here is not a request, and
// giving it a row in the request log would be the clearest possible way to
// misdescribe what happened. What the privacy centre records instead is that a
// message was answered without one.
const ENGINE_VERIFIED_KEY = "tera-engine-verified-v1";
const engine = (() => {
  let worker = null;
  let sequence = 0;
  const pending = new Map();

  const spawn = () => {
    if (worker) return worker;
    worker = new Worker("/tera/wallet/engine.worker.js", { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        state.engineStatus = {
          phase: data.phase,
          loaded: data.loaded,
          total: data.total,
          file: data.file,
        };
        if (route() === "privacy" || route() === "agent") queueMicrotask(render);
        return;
      }
      if (data.type === "verified") {
        // Stored under the tera- prefix, so the wipe control's existing scan
        // removes it and the next load checks every byte again.
        try {
          localStorage.setItem(ENGINE_VERIFIED_KEY, data.filesHash);
        } catch {
          /* Without storage the check simply runs in full every time. */
        }
        state.engineVerifiedInFull = true;
        return;
      }
      if (data.type === "ready") {
        state.engineInfo = { model: data.model, revision: data.revision, files: data.files };
        return;
      }
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.type === "failed") entry.reject(new Error(data.message));
      else entry.resolve(data);
    };
    worker.onerror = (event) => {
      const message = event.message || "The on-device engine could not start.";
      for (const [, entry] of pending) entry.reject(new Error(message));
      pending.clear();
      state.engineStatus = { phase: "failed", loaded: 0, total: 0, file: "" };
      state.engineError = message;
    };
    return worker;
  };

  const send = (type, payload = {}) =>
    new Promise((resolve, reject) => {
      const id = `engine-${++sequence}`;
      pending.set(id, { resolve, reject });
      spawn().postMessage({ id, type, ...payload });
    });

  return {
    get ready() {
      return state.engineStatus.phase === "ready";
    },
    async prepare() {
      if (this.ready) return;
      state.engineError = "";
      state.engineStatus = { phase: "verify", loaded: 0, total: 0, file: "" };
      render();
      let known = "";
      try {
        known = localStorage.getItem(ENGINE_VERIFIED_KEY) || "";
      } catch {
        /* No storage means no remembered check, which is the safe direction. */
      }
      try {
        await send("prepare", { known });
        state.engineStatus = { phase: "ready", loaded: 0, total: 0, file: "" };
      } catch (error) {
        state.engineStatus = { phase: "failed", loaded: 0, total: 0, file: "" };
        state.engineError = errorMessage(error);
        throw error;
      } finally {
        render();
      }
    },
    async ask(message) {
      const { text } = await send("ask", { turn: buildTurn(message) });
      return text;
    },
    async unload() {
      if (!worker) return;
      try {
        await send("unload");
      } catch {
        /* A worker that will not unload is torn down below regardless. */
      }
      worker.terminate();
      worker = null;
      pending.clear();
      state.engineStatus = { phase: "idle", loaded: 0, total: 0, file: "" };
      state.engineInfo = null;
    },
  };
})();

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
  // Which engine answers a question. The on-device engine is opt-in because it
  // costs a large download; nothing is pre-fetched on the owner's behalf.
  engine: SERVICE,
  engineStatus: { phase: "idle", loaded: 0, total: 0, file: "" },
  engineInfo: null,
  engineError: "",
  engineVerifiedInFull: false,
  // The last ingress refusal, shown above the composer until dismissed. It
  // carries a kind and fixed copy — never anything from the message.
  ingress: null,
  // The owner's endpoints for balance reads, held in the encrypted vault because
  // the URLs can carry their API keys. More than one means each account is read
  // by a different operator, so no single one sees the whole portfolio.
  rpcEndpoints: [],
  rpcChecked: null,
  rpcError: "",
  // Counted per operator, in this page session only. A persisted tally of which
  // operator answered for which account would be a record of the owner's
  // accounts, which is the thing this feature exists to avoid creating.
  rpcReads: {},
  integrity: null,
  keyInfo: null,
  vaultKeyEpoch: 1,
  recovery: null,
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
function keyInfoStorageKey() {
  return `${storageKey()}:keyinfo`;
}
function recoveryStorageKey() {
  return `${storageKey()}:recovery`;
}
// The key parameters are not secret: an epoch, a salt and whether a passphrase
// is required. They are stored in the clear because the vault cannot be opened
// without them, including after a rotation that this tab did not perform.
function readKeyInfo() {
  try {
    const raw = localStorage.getItem(keyInfoStorageKey());
    const info = raw ? JSON.parse(raw) : null;
    return isKeyInfo(info) ? info : null;
  } catch {
    return null;
  }
}
function writeKeyInfo(info) {
  localStorage.setItem(keyInfoStorageKey(), JSON.stringify(info));
}
function readRecoveryBlob() {
  try {
    const raw = localStorage.getItem(recoveryStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
// Everything the vault holds, in one place, so export, recovery and rotation
// all carry exactly what persist() writes.
function vaultPayload() {
  return {
    records: state.records,
    bridges: state.bridges,
    drafts: state.drafts,
    versions: state.versions,
    agentSessionToken: state.agentSessionToken,
    presets: state.presets,
    rpcEndpoints: state.rpcEndpoints,
  };
}
async function persist() {
  if (!state.owner || !state.vaultKey) return;
  const targetStorageKey = vaultStorageKey();
  try {
    const vault = await encryptVault(state.vaultKey, vaultPayload(), state.vaultRetentionDays);
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
  state.rpcEndpoints = [];
  state.rpcChecked = null;
  state.rpcError = "";
  // The read tally deliberately survives an account switch. It counts what each
  // operator has been asked in this page session, and switching account does not
  // make an operator forget the account it answered for a moment ago. Resetting
  // it here would show a smaller number than the operator actually holds, which
  // is the one direction this panel is not allowed to be wrong in.
  state.keyInfo = null;
  state.vaultKeyEpoch = 1;
  state.recovery = null;
  const stored = Number(localStorage.getItem(vaultSettingsKey()));
  state.vaultRetentionDays = [7, 30, 90, 365].includes(stored) ? stored : 30;
}
async function unlockEncryptedStorage(passphrase = "") {
  connected();
  const info = readKeyInfo();
  const key = await unlockVault(state.provider, state.owner, chainId, info, passphrase);
  const raw = localStorage.getItem(vaultStorageKey());
  let vault;
  try {
    vault = raw ? await decryptVault(key, JSON.parse(raw)) : null;
  } catch {
    // The key derived, but it does not open this vault. With a passphrase set
    // that is overwhelmingly a wrong passphrase; say so instead of reporting a
    // decryption failure the owner cannot act on.
    throw new Error(
      info?.passphrase
        ? "That passphrase did not open your vault. Your wallet signature was accepted, so check the passphrase."
        : "Your encrypted vault could not be opened with this wallet. It may belong to another account.",
    );
  }
  state.vaultKey = key;
  state.keyInfo = info;
  state.vaultKeyEpoch = info?.epoch || 1;
  state.records = Array.isArray(vault?.records)
    ? vault.records.filter(
        (r) => isHash(r.txHash) && sameAddress(r.owner, state.owner) && r.chainId === chainId,
      )
    : [];
  state.drafts = Array.isArray(vault?.drafts) ? vault.drafts : [];
  state.bridges = Array.isArray(vault?.bridges)
    ? vault.bridges.filter((r) => sameAddress(r.ownerAddress, state.owner) && isHash(r.requestId))
    : [];
  // Version history follows the same retention window as the rest of the vault.
  state.versions = pruneVersions(vault?.versions, state.vaultRetentionDays);
  state.agentSessionToken =
    typeof vault?.agentSessionToken === "string" ? vault.agentSessionToken : "";
  state.presets = Array.isArray(vault?.presets) ? vault.presets.map(createPreset) : [];
  // A stored endpoint is re-validated on unlock rather than trusted, so an old
  // or edited vault cannot point balance reads somewhere this wallet refuses.
  // A vault written before read isolation held one endpoint under `rpcEndpoint`.
  // It is read as a pool of one so an existing setup keeps working untouched.
  state.rpcEndpoints = [];
  const savedEndpoints = Array.isArray(vault?.rpcEndpoints)
    ? vault.rpcEndpoints
    : typeof vault?.rpcEndpoint === "string" && vault.rpcEndpoint
      ? [vault.rpcEndpoint]
      : [];
  if (savedEndpoints.length) {
    try {
      state.rpcEndpoints = poolUrls(createPool(savedEndpoints));
    } catch {
      state.notice =
        "The saved balance endpoints are no longer acceptable and were not restored. Balance reads are going through your wallet.";
    }
  }
  state.recovery = readRecoveryBlob();
  // Remove the previous plaintext record store after the encrypted vault unlocks.
  localStorage.removeItem(storageKey());
}
function clearEncryptedStorage() {
  if (!state.owner) return;
  localStorage.removeItem(vaultStorageKey());
  localStorage.removeItem(storageKey());
  localStorage.removeItem(keyInfoStorageKey());
  localStorage.removeItem(recoveryStorageKey());
  state.keyInfo = null;
  state.vaultKeyEpoch = 1;
  state.recovery = null;
  state.records = [];
  state.bridges = [];
  state.drafts = [];
  state.agentSessionToken = "";
  state.rpcEndpoints = [];
  state.rpcChecked = null;
}
/**
 * Retire the current vault key and write the same contents under a new one.
 * The new key needs its own wallet signature, because the epoch is part of the
 * signed message. The vault and its parameters are replaced together: if the
 * signature is declined nothing is touched, and the old key still works.
 */
async function rotateVaultKey({ passphrase = "", keepPassphrase = null } = {}) {
  connected();
  if (!state.vaultKey) throw new Error("Unlock the vault before rotating its key.");
  const wantsPassphrase =
    keepPassphrase === null ? Boolean(state.keyInfo?.passphrase) : keepPassphrase;
  if (wantsPassphrase) {
    const issue = passphraseIssue(passphrase);
    if (issue) throw new Error(issue);
  }
  const payload = vaultPayload();
  const info = newKeyInfo({ epoch: nextEpoch(state.keyInfo), passphrase: wantsPassphrase });
  const scope = scopeFor(state.owner, chainId);
  const signature = await requestSignature(state.provider, state.owner, scope, info.epoch);
  const key = await deriveVaultKey({
    signature,
    scope,
    info,
    passphrase: wantsPassphrase ? passphrase : "",
  });
  const vault = await encryptVault(key, payload, state.vaultRetentionDays);
  // Written in this order so a failure never leaves parameters that describe a
  // key no stored vault was encrypted under.
  localStorage.setItem(vaultStorageKey(), JSON.stringify(vault));
  writeKeyInfo(info);
  state.vaultKey = key;
  state.keyInfo = info;
  state.vaultKeyEpoch = info.epoch;
  // A recovery set made from the old key still decrypts to the same contents,
  // but it is no longer a copy of what the vault holds now.
  if (state.recovery) state.recovery = { ...state.recovery, stale: true };
  return info;
}

async function deleteServerAssistantData() {
  connected();
  const timestamp = Date.now();
  const message = `Tera Wallet data deletion\nWallet: ${state.owner.toLowerCase()}\nTimestamp: ${timestamp}`;
  const signature = await state.provider.request({
    method: "personal_sign",
    params: [message, state.owner],
  });
  const result = await api(
    `/api/account/${state.owner}/assistant-data`,
    { signature, timestamp },
    { method: "DELETE" },
  );
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
      bridge: () =>
        bridgeView({
          esc,
          pair,
          button,
          records: state.bridges,
          owner: state.owner,
          demo: state.demo,
        }),
      policy,
      sessions,
      receipts,
      privacy: privacyCentre,
      settings,
    }[key] || overview;
  app.innerHTML = `<div class="wallet-wrap">
    <header class="wallet-head"><a class="wordmark" href="/"><img src="/tera/logo.png" alt="">TERA WALLET</a><div class="actions">${integrityChip()}${state.demo ? chip("Guided demo · sample data") : chip(state.owner ? short(state.owner) : "Owner controlled")}${state.demo ? button("Exit demo", "demo-exit") : button(state.owner ? "Wallet ↗" : "Connect wallet ↗", state.owner ? "wallet-account" : "connect", state.busy ? "disabled" : "")}<button class="btn live-menu" aria-expanded="false" aria-controls="wallet-navigation" data-action="menu">Menu</button></div></header>
    <nav id="wallet-navigation" class="wallet-nav" aria-label="Wallet navigation">${Object.entries(
      titles,
    )
      .map(
        ([k, label], i) =>
          `<a href="${href(k)}" ${key === k ? 'class="active" aria-current="page"' : ""}>${String(i + 1).padStart(2, "0")} ${label}</a>`,
      )
      .join("")}</nav>
    <main id="wallet-content"><div class="page-heading"><div><div class="eyebrow">Private authorization / Your authority</div><h1 tabindex="-1">${titles[key] || "Overview"}${key === "dashboard" ? "." : ""}</h1></div><p>The agent proposes. You review the checks and approve in your wallet.</p></div>
    ${state.integrity?.status === "modified" ? `<div class="live-notice integrity-alarm" role="alert"><span><b>This page does not match the published release.</b> ${esc(state.integrity.matched)} of ${esc(state.integrity.checked)} modules match. Do not approve a transaction from this page until you know why. <a href="${href("settings")}">See which files ↗</a></span></div>` : ""}
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
// The engine's state as one chip, so the composer says what will happen to the
// next message without the owner opening the privacy centre.
function engineChip() {
  if (state.engine !== DEVICE) return chip("Sent to Tera");
  const { phase, loaded, total } = state.engineStatus;
  if (phase === "ready") return chip("Nothing will be sent");
  if (phase === "verify" || phase === "load")
    return chip(
      total ? `Loading model · ${Math.round((loaded / total) * 100)}%` : "Loading model…",
    );
  if (phase === "failed") return chip("Model unavailable", true);
  return chip("Model not loaded", true);
}

function engineHint() {
  if (state.engine !== DEVICE) return ENGINES[SERVICE].sends;
  const capability = engineCapabilities();
  if (!capability.supported)
    return `${capability.reason} Questions cannot be answered on this device.`;
  if (state.engineStatus.phase === "failed")
    return `${state.engineError} Nothing was sent in its place.`;
  if (state.engineStatus.phase !== "ready")
    return "The model is not on this device yet. Load it in the privacy status centre. Until then, a question sent this way is not answered and is not sent anywhere either.";
  return `${ENGINES[DEVICE].sends} ${ENGINES[DEVICE].quality}`;
}

// The refusal, shown where the message would have gone. It is not a chat turn:
// a chat turn implies something was processed, and nothing was.
function ingressBanner() {
  const verdict = state.ingress;
  if (!verdict || verdict.safe) return "";
  return `<div class="note note-refused" role="alert"><strong>${esc(verdict.label)} — not sent</strong>${esc(verdict.detail)}
    <p class="micro">Your message box has been cleared. ${verdict.kind === "mnemonic" ? "If you typed this here by mistake, treat the phrase as exposed to anything else running on this device and move your funds to a wallet made from a new one." : ""}</p>
    <details class="micro"><summary>What this check cannot do</summary><ul>${INGRESS_LIMITS.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul></details>
    <div class="actions">${button("Dismiss", "ingress-dismiss")}</div></div>`;
}

// One line under a reply: who answered, whether anything left, and a handle for
// the turn. The handle is what makes two receipts comparable later.
function receiptChip(message) {
  const receipt = message.receipt;
  if (!receipt) return "";
  const index = state.chat.indexOf(message);
  return `<p class="micro receipt-line">${chip(receipt.sent ? "Sent to Tera" : "Nothing sent", receipt.sent)}<code>${esc(receipt.shortRef)}</code>${button("Receipt", "receipt-open", `data-index="${index}"`)}</p>`;
}

/**
 * Show a receipt, rechecked in front of the owner.
 *
 * It is verified on open rather than displayed from what was stored, so what is
 * on screen is the result of running the checks now — including against a
 * transcript the page could in principle have altered since.
 */
async function openReceipt(index) {
  const message = state.chat[Number(index)];
  const receipt = message?.receipt;
  if (!receipt) return;
  const source = ANSWERED_BY[receipt.answeredBy];
  const result = await verifyReceipt(receiptBundle(receipt, message.transcript || {}), {
    recover: recoverReceiptSigner,
  });
  const counts = receiptTally(result.checks);
  const mark = { pass: "PASS", fail: "FAILED", unverifiable: "UNPROVEN", skipped: "N/A" };
  dialog(
    `Receipt ${receipt.shortRef}`,
    `<p><b>${esc(source.label)}.</b> ${esc(source.detail)}</p>
     ${pair("Answered by", source.label)}${receipt.module ? pair("Read from", receipt.module) : ""}${receipt.model ? pair("Model", receipt.model) : ""}${pair("Anything sent", receipt.sent ? "Yes, to Tera's assistant service" : "No request was made")}${receipt.minimised ? pair("Replaced before sending", `${receipt.replaced} ${receipt.replaced === 1 ? "value" : "values"}`) : ""}${pair("Build release", receipt.release || "Not recorded")}${pair("Recorded at", receipt.at)}
     <div class="section-label">Checks<span class="micro">${counts.pass} passed · ${counts.failed} failed · ${counts.unverifiable} unproven · ${counts.skipped} not applicable</span></div>
     <div class="table-scroll"><table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>${result.checks
       .map(
         (entry) =>
           `<tr><td>${esc(entry.label)}</td><td><b class="receipt-${esc(entry.status)}">${mark[entry.status]}</b></td><td class="privacy-wrap">${esc(entry.detail)}</td></tr>`,
       )
       .join("")}</tbody></table></div>
     <div class="note"><strong>What this receipt does not establish</strong><ul class="micro">${RECEIPT_CLAIMS.cannot.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></div>
     <p class="micro">${esc(EXPORT_WARNING)}</p>
     <div class="actions">${receipt.signature ? "" : button("Sign this receipt", "receipt-sign", `data-index="${Number(index)}" ${state.owner ? "" : "disabled"}`)}${button("Export receipt", "receipt-export", `data-index="${Number(index)}"`)}${button("Close", "close")}</div>
     ${receipt.signature ? "" : `<p class="micro">Signing asks your wallet for a signature over a short piece of readable text. It moves nothing and cannot authorise a transaction — the first line of what you will be shown is <code>${esc(DOMAIN)}</code>, which is what keeps it from being usable as anything else this wallet asks you to sign.</p>`}`,
  );
}

// Tearing the worker down first means nothing is holding the weights open when
// the cache is cleared. The duress wipe does the same thing in the same order.
async function unloadEngine() {
  await engine.unload();
  await wipeCaches(globalThis.caches);
  try {
    localStorage.removeItem(ENGINE_VERIFIED_KEY);
  } catch {
    /* Nothing to forget if storage is unavailable. */
  }
  state.engineVerifiedInFull = false;
  state.notice = "The on-device model was removed from this browser.";
  render();
}

/**
 * A decision that cannot be taken back, asked in the wallet's own window.
 *
 * These were browser confirms, which is the wrong surface for them twice over:
 * a confirm cannot show what is about to go, and it looks like the page asking
 * rather than the wallet. The shape is fixed on purpose — what happens, what it
 * costs, what survives it — so four unrelated decisions read the same way and an
 * owner only has to learn where to look once.
 *
 * `keeps` matters as much as `goes`. Most of these read as total from the title
 * alone, and an owner who cannot see the limit assumes the widest reading.
 */
function confirmDialog(
  { title, lead, consequence, heavy = true, goes = [], keeps = [], confirmLabel, cancelLabel },
  run,
) {
  const list = (items, extra = "") =>
    `<ul class="decision-list ${extra}">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
  const panel = dialog(
    title,
    `<p>${esc(lead)}</p>
     ${consequence ? `<div class="note ${heavy ? "note-heavy" : ""}"><p>${esc(consequence)}</p></div>` : ""}
     ${goes.length ? `<div class="section-label">What this does</div>${list(goes)}` : ""}
     ${keeps.length ? `<div class="section-label">What it does not touch</div>${list(keeps, "keeps")}` : ""}
     <div class="actions"><button class="btn primary" data-confirm>${esc(confirmLabel)}</button>${button(cancelLabel || "Cancel", "close")}</div>`,
  );
  const go = panel.querySelector("[data-confirm]");
  // Run outside the click dispatcher, so its error handling has to be repeated
  // here rather than assumed.
  go.onclick = async () => {
    go.disabled = true;
    try {
      await run();
    } catch (error) {
      showError(error);
    }
  };
  return panel;
}

// The export decision, in the wallet's own dialog. Everything shown here is
// derived from the receipt in hand rather than written once for all receipts,
// because the honest sentence differs: a turn answered on this device has text
// that has never left, and a turn the service answered does not.
function receiptExportDialog(index) {
  const message = state.chat[Number(index)];
  const receipt = message?.receipt;
  if (!receipt) return;
  const notice = exportNotice(receipt);
  dialog(
    "Export this receipt?",
    `<p><b>${esc(notice.headline)}</b> ${esc(notice.detail)}</p>
     <div class="note ${notice.firstSend ? "note-heavy" : ""}"><p>${esc(notice.consequence)}</p></div>
     <div class="section-label">What the file contains</div>
     <div class="table-scroll"><table><thead><tr><th>Part</th><th>Detail</th></tr></thead><tbody>${notice.contents
       .map(
         (part) =>
           `<tr><td><b>${esc(part.label)}</b></td><td class="privacy-wrap">${esc(part.detail)}</td></tr>`,
       )
       .join("")}</tbody></table></div>
     ${pair("Receipt", receipt.shortRef)}${pair("Answered by", ANSWERED_BY[receipt.answeredBy]?.label || "Not recorded")}${pair("File name", `tera-receipt-${receipt.shortRef}.json`)}
     <div class="actions"><button class="btn primary" data-action="receipt-export-confirm" data-index="${Number(index)}">Save the file</button>${button("Keep it here", "close")}</div>
     <p class="micro">Nothing is uploaded. The file is written to this device's downloads, and where it goes after that is up to you.</p>`,
  );
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
// The one line above the five checks. It replaces nothing on the web — there
// was no summary here at all, only five rows an owner had to read and add up
// themselves, which meant a single unproven check looked like four passes and
// something slightly odd.
function gateSummaryBlock(proposal) {
  const verdicts = gateVerdicts(proposal?.gates, GATES);
  const summary = summariseVerdicts(verdicts);
  const unproven = verdicts.filter((entry) => entry.status === VERDICT_UNVERIFIABLE);
  return `<div class="note note-${esc(summary.status)}"><strong>${esc(summary.status === VERDICT_PASS ? "Checks" : "Read this first")}</strong>${esc(summary.line)}${
    unproven.length
      ? `<ul class="micro">${unproven
          .map(
            (entry) =>
              `<li><b>${esc(GATE_LABELS[entry.gate] || entry.gate)}</b> — ${esc(entry.detail)}</li>`,
          )
          .join("")}</ul>`
      : ""
  }</div>`;
}

function chatBubble(message) {
  if (message.role !== "user") {
    // A deterministic answer is labelled as the wallet's own text, not as an
    // assistant reply. It is a stronger claim than either engine can make and
    // the owner should be able to tell the difference at a glance.
    const role = message.local
      ? `From this wallet's code${message.cites ? ` ${chip(message.cites)}` : ""}`
      : message.device
        ? "On this device"
        : "Tera assistant";
    const footer = message.note
      ? `<p class="micro">${esc(message.note)}</p>`
      : message.device
        ? `<p class="micro">${esc(attribution(DEVICE))}</p>`
        : "";
    return `<div class="chat-bubble${message.withheld ? " withheld" : ""}${message.local ? " sourced" : ""}"><strong class="chat-role">${role}${message.withheld ? ` ${chip("Answer withheld", true)}` : ""}</strong><div class="assistant-markdown">${renderAssistantMarkdown(message.text)}</div>${footer}${receiptChip(message)}</div>`;
  }
  const replaced = message.removed?.length || 0;
  const detail = message.minimised
    ? `<details class="minimise-sent"><summary>${replaced} ${replaced === 1 ? "value" : "values"} replaced · what left this device</summary><pre>${esc(message.sent)}</pre>${message.kept?.length ? `<p class="micro">Kept as typed: ${esc(message.kept.map((kind) => KIND_LABELS[kind].toLowerCase()).join(", "))}.</p>` : ""}</details>`
    : `<p class="micro minimise-sent-plain">Sent as typed.</p>`;
  return `<div class="chat-bubble user"><strong class="chat-role">You</strong>${esc(message.text)}${detail}</div>`;
}
function chat() {
  return `<div class="section-label">Agent assistant ${chip("Owner supervised")}</div>
    <div class="note">Ask a question or request an action. Questions this wallet can answer exactly from its own code — the five checks, the approval boundary, what each privacy control does — are answered here from that code, with no model and no request. Anything else goes to the engine you pick below.</div>
    <div class="toolbar">${state.agentSessionToken ? chip("Scoped token connected") + button("Disconnect token", "agent-token-disconnect") : button("Connect session token", "agent-token-connect", !state.owner ? "disabled" : "")}<label class="share-toggle minimise-toggle"><input type="checkbox" data-action="minimise-toggle" ${state.minimise ? "checked" : ""}> Minimise before sending</label></div>
    <div class="toolbar engine-toolbar"><label class="share-toggle"><span>Answered by</span> <select data-action="engine-select" aria-label="Which engine answers a question">${[SERVICE, DEVICE].map((id) => `<option value="${id}" ${state.engine === id ? "selected" : ""}>${esc(ENGINES[id].label)}</option>`).join("")}</select></label>${engineChip()}</div>
    <p class="micro" id="engine-hint">${esc(engineHint())}</p>
    <p class="micro" id="minimise-hint">${esc(state.engine === DEVICE ? "Prompt minimisation applies to messages that are sent. A question answered on this device is not sent, so there is nothing to minimise — but preparing a proposal still goes to Tera, and it is minimised then." : minimiseHint())}</p>
    ${ingressBanner()}
    <div class="chat-feed" aria-live="polite">${state.chat.length ? state.chat.map(chatBubble).join("") : '<p class="micro">Explore an asset or describe a proposal you want to review.</p>'}</div>
    <form id="chat-form"><div class="field"><label for="chat-mode">Message type</label><select id="chat-mode" name="mode"><option value="chat">Ask a question</option><option value="propose">Prepare a proposal</option></select></div>
    <div class="composer"><textarea name="message" aria-label="Message the agent" placeholder="Ask about an asset or describe an action…" required maxlength="1200"></textarea><button aria-label="Send message" ${state.busy ? "disabled" : ""}>↑</button></div>
    <p class="micro">${state.agentSessionToken ? "This token is checked before Tera prepares a proposal. Wallet approval is still required." : "Messages are processed by Tera’s assistant service. Proposals always require your review."}</p></form>`;
}

function connectAgentSessionToken() {
  connected();
  if (!state.vaultKey)
    throw new Error(
      "Unlock encrypted local storage in Settings before connecting a session token.",
    );
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
    ${gateSummaryBlock(p)}
    <ul class="status-list">${GATES.map((name, i) => {
      const g = p.gates?.find((g) => g.gate === name);
      const detail = explainGate(name, g);
      const status =
        i === 4 && detail.status === VERDICT_PASS ? "AWAITING SIGNATURE" : detail.result;
      return `<li class="gate-${esc(detail.status)}${g?.passed === false ? " blocked" : ""}"><details class="gate-detail"><summary><span class="audit-num">0${i + 1}</span><span class="gate-name">${esc(detail.label)}${g?.reason ? `<small>${esc(g.reason)}</small>` : ""}</span><b>${status}</b></summary>
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
  const assets = state.assets.filter(
    (asset) => isAddress(asset.address) && asset.status === "ACTIVE",
  );
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
      // One entry per operator, so the panel can say which of them saw what.
      balanceEndpoints: ownEndpointActive()
        ? endpointPool().map(({ party, host, local }) => ({ party, host, local }))
        : [],
      ohttpRelayHost: oblivious?.host || "",
      ohttpPaths: oblivious ? obliviousPaths : [],
    }),
    {
      log: state.privacyLog,
      owner: state.owner,
      demo: state.demo,
      records: state.records.length,
      balanceReads: state.rpcReads,
    },
  );
}
const hostOf = (value) => {
  try {
    return value ? new URL(value).host : "";
  } catch {
    return "";
  }
};

// Where an approved transaction goes once it is signed, and who reads it on the
// way. Rendered from the model in submission.js rather than written here, so the
// panel and the claims it makes cannot drift apart.
function submissionPanel() {
  const path = describeSubmission({
    chainId,
    chainName: "Robinhood Chain",
    // A malformed value in the page config must not take the privacy centre down
    // with it: an unnamed host is a worse panel, a thrown error is no panel.
    sequencerHost: hostOf(config.rpcUrl),
    explorerHost: hostOf(config.explorerUrl),
    // Receipts reach Tera only for transactions the owner chose to reconcile.
    receiptSync: state.records.some((record) => record.recorded),
  });
  const row = (entry) =>
    `<tr><td><b>${esc(entry.name)}</b>${entry.host ? `<small>${esc(entry.host)}</small>` : ""}${entry.privileged ? " " + chip("sees it first") : ""}${entry.optional && !entry.active ? " " + chip("not used") : ""}</td><td>${esc(entry.when)}</td><td>${entry.learns.map((item) => esc(item)).join("<br>")}<small>${esc(entry.note)}</small></td></tr>`;
  return `<div class="note"><strong>${esc(path.model.label)}</strong>${esc(path.model.summary)} ${esc(path.model.correction)}</div>
    <div class="section-label"><span>Where an approved transaction goes</span><span>${path.privileged} party sees it before anyone else</span></div>
    <div class="table-scroll"><table><thead><tr><th>Party</th><th>When</th><th>What it learns</th></tr></thead><tbody>${path.hops.map(row).join("")}</tbody></table></div>
    <p class="micro">${esc(path.whyFixed)}</p>
    <ul class="micro">${path.limits.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul>`;
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
      ${oblivious ? `<div class="metric"><strong>${totals.oblivious}</strong><small>Requests sealed and sent through a relay</small></div>` : ""}
      <div class="metric"><strong>${reachTotals.seeingYouNow}</strong><small>Parties in a position to see you right now</small></div>
      <div class="metric"><strong>${totals.fields}</strong><small>Distinct fields sent</small></div>
    </div>
    ${
      oblivious
        ? `<div class="note"><strong>Sealed transport</strong>${totals.oblivious} request${totals.oblivious === 1 ? "" : "s"} in this session ${totals.oblivious === 1 ? "was" : "were"} encrypted on this device and sent to Tera through ${esc(oblivious.host)}, so Tera answered ${totals.oblivious === 1 ? "it" : "them"} without learning the network address ${totals.oblivious === 1 ? "it" : "they"} came from. The routes that go this way are ${obliviousPaths.map((path) => esc(path)).join(" and ")}; everything else on this page still connects to Tera directly.<ul class="micro">${OHTTP_LIMITS.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul></div>`
        : ""
    }
    <div class="note"><strong>Prompt minimisation</strong>${state.minimise ? "Assistant messages are scrubbed on this device before they are sent: addresses, references, contact details and figures are replaced with placeholders, and the reply is re-hydrated here. A proposal keeps the recipient and the figure, because Tera reads those out of the text to build the transaction." : "Prompt minimisation is off, so assistant messages are sent exactly as you type them."} It removes the values from the text. It does not hide that you are asking, and it does not hide the network address the request comes from.</div>
    <div class="note"><strong>Data boundary</strong>Requests go to ${esc(serviceHost)}. Balances and receipts are read directly through your wallet's network provider, so Tera does not see them. The log below records field names only — never an address, an amount or the text you typed. Tera is not the only party involved: the panel further down names every other one.</div>
    ${
      state.demo
        ? `<div class="note"><strong>Guided demo</strong>Every request below was answered locally. Nothing reached ${esc(serviceHost)} and nothing was signed.</div>`
        : `<div class="note"><strong>Guided demo</strong>Want to show this boundary without a real account? ${button("Start guided demo", "demo-start")}</div>`
    }
    <div class="note"><strong>On-device engine</strong>${state.engineStatus.phase === "ready" ? `Questions asked with “${esc(ENGINES[DEVICE].label)}” selected are answered in this tab. ${totals.onDevice} ${totals.onDevice === 1 ? "question was" : "questions were"} answered that way in this session, and ${totals.onDevice === 1 ? "it made" : "they made"} no request at all.` : "A small model can run in this tab so a question is answered without any request being made. It is opt-in, because loading it is a large one-time download."} It cannot prepare a proposal: that needs Tera's registry and the five checks.</div>
    ${submissionPanel()}
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
        <section class="panel"><h2>What cannot be sent</h2>${ingressPanel()}</section>
        <section class="panel"><h2>On-device engine</h2>${enginePanel()}</section>
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

function integrityChip() {
  const mark = integrityBadge(state.integrity);
  const tone = mark.tone === "fail" ? "fail" : mark.tone === "muted" ? "muted" : "";
  return `<span class="chip integrity-chip ${tone}" title="Code transparency">${esc(mark.label)}</span>`;
}
// The on-device engine's own panel. It has to sell the download honestly: the
// benefit is one sentence and the costs are two lists, and the costs are not
// behind a disclosure triangle.
function enginePanel() {
  const capability = engineCapabilities();
  const { phase, loaded, total, file } = state.engineStatus;
  const progress =
    total > 0
      ? `<div class="metric"><strong>${Math.round((loaded / total) * 100)}%</strong><small>${esc(phase === "verify" ? "Checking the published digests" : "Building the model")}${file ? ` · ${esc(file)}` : ""}</small></div>`
      : "";
  const status =
    phase === "ready"
      ? `<p><strong>Loaded.</strong> Questions you ask with “${esc(ENGINES[DEVICE].label)}” selected are answered here and no request is made.${state.engineInfo ? ` Running ${esc(state.engineInfo.model)}${state.engineInfo.revision ? ` at ${esc(state.engineInfo.revision.slice(0, 12))}` : ""}, ${state.engineInfo.files} files, each checked against the published digest before it was loaded.` : ""}</p>`
      : phase === "failed"
        ? `<p class="live-form-error" role="alert">${esc(state.engineError)}</p><p class="micro">Nothing was sent to Tera in its place. The service assistant is still available from the composer.</p>`
        : capability.supported
          ? `<p>The model is not on this device. Loading it downloads the weights from this site once, checks every file against the published digest, and builds the model in a worker.</p>`
          : `<p class="live-form-error" role="alert">${esc(capability.reason)}</p>`;
  return `<p>${esc(ENGINES[DEVICE].detail)}</p>
    ${status}
    ${progress ? `<div class="privacy-totals">${progress}</div>` : ""}
    <div class="actions">${button(phase === "ready" ? "Loaded" : phase === "verify" || phase === "load" ? "Loading…" : "Load the model", "engine-load", !capability.supported || phase === "ready" || phase === "verify" || phase === "load" ? "disabled" : "")}${button("Remove from this device", "engine-unload", phase === "ready" ? "" : "disabled")}</div>
    <div class="note"><strong>What it cannot do</strong><ul class="micro">${ENGINE_LIMITS.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul></div>
    <div class="note"><strong>What the download costs</strong><ul class="micro">${WEIGHTS_LIMITS.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul></div>
    ${phase === "ready" && !state.engineVerifiedInFull ? `<p class="micro">These files were checked in full on an earlier visit, and this load took the browser's own copy for this site without reading all ${esc(String(state.engineInfo?.files ?? ""))} of them again. Any change to what Tera publishes changes the manifest, and the full check runs again.</p>` : ""}`;
}

// What the ingress gate refuses. Listed in the privacy centre so an owner can
// see the rule before they trip it, rather than only after.
function ingressPanel() {
  return `<p>Everything else on this page is about what leaves. This is the one check on what comes in: a message carrying a secret is refused at the composer and is not minimised, parsed, shown to the on-device model, sent, or written to the log below.</p>
    <div class="section-label">Refused outright</div>
    ${Object.values(INGRESS_KINDS)
      .map(
        (kind) =>
          `<article class="panel privacy-local"><b>${esc(kind.label)}</b><p class="micro">${esc(kind.detail)}</p></article>`,
      )
      .join("")}
    <div class="note"><strong>What this check cannot do</strong><ul class="micro">${INGRESS_LIMITS.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul></div>`;
}

function codeTransparencyPanel() {
  const result = state.integrity;
  const mark = integrityBadge(result);
  const rows = result?.files || [];
  const failing = rows.filter((file) => !file.ok);
  const shown = failing.length ? failing : rows;
  return `<p>${esc(integritySummary(result, location.host))}</p>
    ${result ? pair("Release", result.release || "Not published") : ""}
    ${result?.builtAt ? pair("Built", new Date(result.builtAt).toLocaleString()) : ""}
    ${result ? pair("Manifest", result.signed ? (result.signerOk ? "Signed and verified" : result.signerOk === null ? "Signed · not checkable here" : "Signed · signature failed") : "Published without a signature") : ""}
    ${result ? pair("Modules matching", `${result.matched} of ${result.checked}`) : ""}
    <div class="actions">${button("Check again", "integrity-recheck")}${button("Download manifest", "integrity-download", result ? "" : "disabled")}</div>
    ${
      shown.length
        ? `<div class="table-scroll integrity-table"><table><thead><tr><th>Module</th><th>Result</th></tr></thead><tbody>${shown
            .map(
              (file) =>
                `<tr><td><b>${esc(file.path)}</b><small>${esc(file.ok ? file.expected : `expected ${file.expected}`)}</small>${file.ok ? "" : `<small>${esc(file.actual ? `served ${file.actual}` : "could not be read")}</small>`}</td><td>${chip(file.ok ? "Matches" : "Does not match", !file.ok)}</td></tr>`,
            )
            .join(
              "",
            )}</tbody></table></div>${failing.length ? "" : '<p class="micro">Every module checked is listed above with the hash it was published under.</p>'}`
        : ""
    }
    <p class="micro"><b>What this proves.</b> The files this site is serving right now match a published list of hashes${result?.signed && result?.signerOk ? ", and that list was signed by the expected key" : ""}. ${mark.tone === "ok" ? "That is what a good result means, and no more." : ""}</p>
    <p class="micro"><b>What it does not prove.</b> It cannot hash the code already running in this tab, and it cannot save you from an origin that has been taken over — whoever can replace a module can replace this checker. The published hashes are the part that survives that: fetch the files yourself and compare, or check them against the public source. The connection bundle under /tera/connect/ is a build output and is not covered.</p>
    <p class="micro">Verify one yourself, from a terminal:</p>
    <div class="share-preview"><pre>curl -s https://${esc(location.host)}/tera/wallet/app.js | openssl dgst -binary -sha256 | openssl base64 -A</pre></div>`;
}

function vaultKeyPanel() {
  const info = state.keyInfo;
  const locked = !state.vaultKey;
  const recovery = state.recovery;
  return `<p>The key that opens this browser's vault is derived from a wallet signature. It can be retired and replaced, given a passphrase as a second factor, carried to another device, or split into recovery shares.</p>
    ${pair("Key epoch", locked ? "Vault locked" : String(state.vaultKeyEpoch))}
    ${pair("Second factor", info?.passphrase ? "Passphrase required" : "Wallet signature only")}
    ${info?.createdAt ? pair("Key created", new Date(info.createdAt).toLocaleString()) : ""}
    ${recovery ? pair("Recovery set", `${recovery.threshold} of ${recovery.shares} shares${recovery.stale ? " · made before the last rotation" : ""}`) : ""}
    <div class="actions">${button("Rotate key", "vault-rotate", locked ? "disabled" : "")}${button(info?.passphrase ? "Change or remove passphrase" : "Add a passphrase", "vault-passphrase", locked ? "disabled" : "")}</div>
    <div class="actions">${button("Export for another device", "vault-export", locked ? "disabled" : "")}${button("Import an export", "vault-import", locked ? "disabled" : "")}</div>
    <div class="actions">${button(recovery ? "Replace recovery shares" : "Create recovery shares", "vault-recovery-create", locked ? "disabled" : "")}${button("Recover from shares", "vault-recovery-use", locked ? "disabled" : "")}</div>
    <p class="micro">Rotation asks for a new wallet signature, because the epoch is part of what you sign. The old signature stops deriving the key, so a copy of it is no longer enough to open this vault.</p>
    <p class="micro">A passphrase protects this browser's copy. It is not a second factor for anything Tera holds, it never leaves this device, and it cannot be reset — if you lose it, these contents are gone and nothing here brings them back.</p>
    <p class="micro"><b>Recovery shares are people.</b> Any ${recovery ? recovery.threshold : "threshold"} holders acting together open the vault without you. Nothing here prevents that, detects it, or tells you it happened. Choose holders on that basis.</p>
    <p class="micro">None of this recovers your wallet or moves funds. It covers what this browser stored: drafts, presets, version history, bridge tracking and device-side records.</p>`;
}
function passphrasePrompt(title, body, onSubmit) {
  dialog(
    title,
    `<form id="vault-pass-form">${body}<div class="field"><label for="vault-pass">Passphrase</label><input id="vault-pass" name="passphrase" type="password" autocomplete="off" required></div><p class="live-form-error" role="alert"></p><button class="btn primary">Continue ↗</button></form>`,
  );
  const form = document.getElementById("vault-pass-form");
  const error = form.querySelector('[role="alert"]');
  form.onsubmit = async (event) => {
    event.preventDefault();
    error.textContent = "";
    try {
      await onSubmit(new FormData(form).get("passphrase"));
    } catch (issue) {
      error.textContent = errorMessage(issue);
    }
  };
}
function rotateVaultKeyDialog() {
  if (!state.keyInfo?.passphrase) {
    dialog(
      "Rotate the vault key",
      `<p>Your wallet will ask you to sign for key epoch ${esc(nextEpoch(state.keyInfo))}. The vault is re-encrypted under the new key, and the old signature stops opening it.</p><p class="micro">This does not approve a transaction and sends nothing to Tera.</p><div class="actions">${button("Sign and rotate", "vault-rotate-confirm")}${button("Cancel", "close")}</div>`,
    );
    return;
  }
  passphrasePrompt(
    "Rotate the vault key",
    `<p>Enter the passphrase to keep on the new key, then sign for epoch ${esc(nextEpoch(state.keyInfo))} in your wallet.</p>`,
    async (passphrase) => {
      await rotateVaultKey({ passphrase, keepPassphrase: true });
      closeDialog();
      state.notice = `Vault key rotated to epoch ${state.vaultKeyEpoch}. The previous signature no longer opens it.`;
      render();
    },
  );
}
function passphraseDialog() {
  if (!state.keyInfo?.passphrase) {
    passphrasePrompt(
      "Add a passphrase",
      `<p>The vault will then need this passphrase as well as your wallet signature. Your wallet will ask you to sign for the new key epoch.</p><p class="micro">There is no reset. Write it down somewhere you will still have it.</p>`,
      async (passphrase) => {
        await rotateVaultKey({ passphrase, keepPassphrase: true });
        closeDialog();
        state.notice =
          "A passphrase is now required to open this vault, with your wallet signature.";
        render();
      },
    );
    return;
  }
  dialog(
    "Passphrase",
    `<p>This vault currently needs a passphrase as well as your wallet signature.</p><div class="actions">${button("Set a new one", "vault-passphrase-set")}${button("Remove it", "vault-passphrase-remove")}${button("Cancel", "close")}</div><p class="micro">Either way the key is rotated, so your wallet will ask for a signature.</p>`,
  );
}
function exportVaultDialog() {
  passphrasePrompt(
    "Export for another device",
    `<p>The file is your vault contents encrypted under a passphrase you choose here — not your wallet signature, so another browser can open it.</p><p class="micro">Whoever has the file and this passphrase can read its contents. It holds no private key and cannot move funds.</p>`,
    async (passphrase) => {
      downloadJson(
        await exportBundle(vaultPayload(), passphrase),
        `tera-vault-export-${Date.now()}.json`,
      );
      closeDialog();
      state.notice = "Vault export downloaded. It is only as safe as the passphrase you chose.";
      render();
    },
  );
}
// Imported and recovered contents pass the same filters as an unlock, so a file
// cannot introduce a record for another account or an endpoint this wallet
// would refuse.
function applyVaultPayload(payload) {
  if (!payload || typeof payload !== "object")
    throw new Error("That file holds no vault contents.");
  if (Array.isArray(payload.records))
    state.records = payload.records.filter(
      (r) => isHash(r.txHash) && sameAddress(r.owner, state.owner) && r.chainId === chainId,
    );
  if (Array.isArray(payload.bridges))
    state.bridges = payload.bridges.filter(
      (r) => sameAddress(r.ownerAddress, state.owner) && isHash(r.requestId),
    );
  if (Array.isArray(payload.drafts)) state.drafts = payload.drafts;
  if (payload.versions) state.versions = pruneVersions(payload.versions, state.vaultRetentionDays);
  if (Array.isArray(payload.presets)) state.presets = payload.presets.map(createPreset);
  if (typeof payload.agentSessionToken === "string")
    state.agentSessionToken = payload.agentSessionToken;
  const importedEndpoints = Array.isArray(payload.rpcEndpoints)
    ? payload.rpcEndpoints
    : typeof payload.rpcEndpoint === "string" && payload.rpcEndpoint
      ? [payload.rpcEndpoint]
      : [];
  if (importedEndpoints.length) {
    try {
      state.rpcEndpoints = poolUrls(createPool(importedEndpoints));
    } catch {
      state.notice =
        "The balance endpoints in that file were not acceptable and were not restored.";
    }
  }
}
function importVaultDialog() {
  dialog(
    "Import an export",
    `<form id="vault-import-form"><p>Choose an export file and the passphrase it was made with. Its contents are merged into this device's vault and re-encrypted under this device's key.</p><div class="field"><label for="vault-file">Export file</label><input id="vault-file" name="file" type="file" accept="application/json,.json" required></div><div class="field"><label for="vault-import-pass">Passphrase</label><input id="vault-import-pass" name="passphrase" type="password" autocomplete="off" required></div><p class="live-form-error" role="alert"></p><button class="btn primary">Import ↗</button></form>`,
  );
  const form = document.getElementById("vault-import-form");
  const error = form.querySelector('[role="alert"]');
  form.onsubmit = async (event) => {
    event.preventDefault();
    error.textContent = "";
    try {
      const data = new FormData(form);
      const file = data.get("file");
      if (!file || !file.size) throw new Error("Choose the export file first.");
      applyVaultPayload(await importBundle(JSON.parse(await file.text()), data.get("passphrase")));
      await persist();
      closeDialog();
      state.notice = "Vault export imported and re-encrypted under this device's key.";
      render();
    } catch (issue) {
      error.textContent = errorMessage(issue);
    }
  };
}
const recoveryState = { shares: [], blob: null };
function createRecoveryDialog() {
  dialog(
    "Create recovery shares",
    `<form id="vault-recovery-form"><p>Your vault contents are encrypted under a fresh random key, and that key is split. Any threshold of the shares rebuilds it.</p><div class="field"><label for="recovery-shares">Number of shares</label><select id="recovery-shares" name="shares">${[3, 4, 5, 6, 7].map((n) => `<option ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></div><div class="field"><label for="recovery-threshold">Shares needed to recover</label><select id="recovery-threshold" name="threshold">${[2, 3, 4, 5].map((n) => `<option ${n === 2 ? "selected" : ""}>${n}</option>`).join("")}</select></div><p class="micro">Any group of that size opens the vault without you, and you will not know. Give the shares to people who would not act together against you.</p><p class="live-form-error" role="alert"></p><button class="btn primary">Create shares ↗</button></form>`,
  );
  const form = document.getElementById("vault-recovery-form");
  const error = form.querySelector('[role="alert"]');
  form.onsubmit = async (event) => {
    event.preventDefault();
    error.textContent = "";
    try {
      const data = new FormData(form);
      const shares = Number(data.get("shares"));
      const threshold = Number(data.get("threshold"));
      if (threshold > shares)
        throw new Error("The threshold cannot be larger than the number of shares.");
      const result = await createRecovery(vaultPayload(), { shares, threshold });
      localStorage.setItem(recoveryStorageKey(), JSON.stringify(result.blob));
      state.recovery = result.blob;
      recoveryState.shares = result.shares;
      recoveryState.blob = result.blob;
      dialog(
        "Your recovery shares",
        `<p>These are shown once. Give each to a different holder, and keep the recovery file somewhere you will still have it.</p><div class="share-preview"><pre>${esc(result.shares.join("\n\n"))}</pre></div><p class="micro">Any ${esc(threshold)} of these ${esc(shares)} open the vault. Fewer reveal nothing about it.</p><div class="actions">${button("Copy shares", "recovery-copy")}${button("Download recovery file", "recovery-download")}${button("Done", "close")}</div>`,
      );
    } catch (issue) {
      error.textContent = errorMessage(issue);
    }
  };
}
function useRecoveryDialog() {
  const blob = state.recovery || readRecoveryBlob();
  dialog(
    "Recover from shares",
    `<form id="vault-recover-form"><p>Paste the shares, one per line. ${blob ? `This device holds a recovery file needing ${esc(blob.threshold)} of ${esc(blob.shares)}.` : "Choose the recovery file as well."}</p>${blob ? "" : '<div class="field"><label for="recover-file">Recovery file</label><input id="recover-file" name="file" type="file" accept="application/json,.json" required></div>'}<div class="field"><label for="recover-shares">Shares</label><textarea id="recover-shares" name="shares" rows="5" placeholder="TERA-R1.2.3.…" required></textarea></div><p class="live-form-error" role="alert"></p><button class="btn primary">Recover ↗</button></form>`,
  );
  const form = document.getElementById("vault-recover-form");
  const error = form.querySelector('[role="alert"]');
  form.onsubmit = async (event) => {
    event.preventDefault();
    error.textContent = "";
    try {
      const data = new FormData(form);
      const file = data.get("file");
      const source = blob || JSON.parse(await file.text());
      const shares = String(data.get("shares"))
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
      applyVaultPayload(await recoverFromShares(source, shares));
      await persist();
      closeDialog();
      state.notice = "Vault contents recovered and re-encrypted under this device's key.";
      render();
    } catch (issue) {
      error.textContent = errorMessage(issue);
    }
  };
}

const WIPE_WORD = "WIPE";
function storagesToWipe() {
  const storages = [];
  try {
    storages.push(localStorage);
  } catch {
    /* A browser with storage blocked has nothing here to remove. */
  }
  try {
    storages.push(sessionStorage);
  } catch {
    /* Same. */
  }
  return storages;
}
function duressPanel() {
  const summary = wipePlan(storagesToWipe());
  return `<p>Destroy everything this site has stored in this browser, for every account, in one step. It works whether or not a wallet is connected and whether or not the vault is unlocked.</p>
    ${pair("Artefacts stored now", String(summary.total))}
    ${summary.accounts ? pair("Accounts represented", String(summary.accounts)) : ""}
    <div class="actions">${button("Wipe this browser", "duress-wipe", summary.total ? "" : "disabled")}</div>
    <p class="micro">No network request is made. Nothing is told to Tera, and nothing needs a signature — which is the point: it works when you cannot safely do anything else.</p>
    <p class="micro"><b>What it cannot reach.</b></p>
    <ul class="wipe-limits">${WIPE_LIMITS.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul>`;
}
function duressWipeDialog() {
  const summary = wipePlan(storagesToWipe());
  if (!summary.total) {
    state.notice = "There is nothing stored in this browser to wipe.";
    render();
    return;
  }
  dialog(
    "Wipe this browser",
    `<p>This destroys ${esc(summary.total)} stored ${summary.total === 1 ? "artefact" : "artefacts"}${summary.accounts > 1 ? `, across ${esc(summary.accounts)} accounts` : ""}. It cannot be undone, and nothing here can bring any of it back.</p>
     <div class="table-scroll"><table><thead><tr><th>What goes</th><th>Count</th></tr></thead><tbody>${summary.categories
       .map(
         (category) =>
           `<tr><td><b>${esc(category.label)}</b><small>${esc(category.detail)}</small></td><td>${esc(category.count)}</td></tr>`,
       )
       .join("")}</tbody></table></div>
     <form id="duress-form"><div class="field"><label for="duress-word">Type ${WIPE_WORD} to confirm</label><input id="duress-word" name="word" autocomplete="off" autocapitalize="characters" spellcheck="false" required></div>
     <p class="micro">Records Tera already holds are not affected by this, and no request is sent. Deleting those is a separate control that needs your signature.</p>
     <p class="live-form-error" role="alert"></p>
     <div class="actions"><button class="btn primary">Wipe everything</button>${button("Cancel", "close")}</div></form>`,
  );
  const form = document.getElementById("duress-form");
  const error = form.querySelector('[role="alert"]');
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (String(new FormData(form).get("word")).trim().toUpperCase() !== WIPE_WORD) {
      error.textContent = `Type ${WIPE_WORD} exactly to confirm.`;
      return;
    }
    const result = wipeStorages(storagesToWipe());
    // The model's weights are in cache storage, which the prefix scan cannot
    // see. Tearing down the worker first means nothing is holding them open.
    await engine.unload();
    const caches = await wipeCaches(globalThis.caches);
    forgetEverything();
    closeDialog();
    const cached = caches.removed ? ` The cached on-device model was removed as well.` : "";
    state.notice =
      result.remaining || caches.remaining
        ? `${result.removed} removed, but ${result.remaining + caches.remaining} could not be. This browser is blocking storage changes; clear site data from browser settings.`
        : `${result.removed} stored ${result.removed === 1 ? "artefact" : "artefacts"} destroyed.${cached} Nothing was sent anywhere.`;
    render();
  };
}
// Storage is only half of it: the same data is in memory on this page until it
// is cleared too, and the page is left as if it had just been opened.
function forgetEverything() {
  generation++;
  // Deliberately not exitDemo(): that reloads the asset registry, which would
  // put a network request in the middle of a control whose whole promise is
  // that it makes none. The demo's sample data is dropped here instead.
  if (state.demo) {
    state.demo = false;
    state.guide = 0;
    state.assets = [];
    state.assetsLoaded = false;
  }
  state.owner = "";
  state.provider = null;
  state.chain = null;
  state.account = null;
  state.history = [];
  state.sessions = [];
  state.balances = {};
  state.records = [];
  state.bridges = [];
  state.drafts = [];
  state.versions = {};
  state.presets = [];
  state.simulation = null;
  state.chat = [];
  state.privacyLog = [];
  state.approval = null;
  state.errors = {};
  state.loading = false;
  state.busy = false;
  state.vaultKey = null;
  state.keyInfo = null;
  state.vaultKeyEpoch = 1;
  state.recovery = null;
  state.agentSessionToken = "";
  state.rpcEndpoints = [];
  state.rpcChecked = null;
  state.rpcError = "";
  state.rpcReads = {};
  state.query = "";
  state.category = "all";
  recoveryState.shares = [];
  recoveryState.blob = null;
  try {
    window.teraRainbowKit?.disconnect();
  } catch {
    /* The wallet connection is the extension's to keep; the wipe does not depend on it. */
  }
}

function balanceReadsPanel() {
  const pool = endpointPool();
  const summary = poolSummary(pool);
  const assigned = state.owner ? assignEndpoint(pool, state.owner) : null;
  const where = assigned
    ? `${esc(assigned.host)}${assigned.local ? " · on this machine" : ""}`
    : summary.parties
      ? "Connect a wallet to see which operator reads for it"
      : "Your wallet extension's own provider";
  const totalReads = Object.values(state.rpcReads).reduce((sum, count) => sum + count, 0);
  return `<p>Every balance in this wallet is read from somewhere. By default that is your wallet extension's provider, which learns each address you look at — including ones you only look at. Point these reads at your own node, or at more than one operator so no single one sees every account you hold.</p>
    ${pair("This account is read by", where)}
    ${summary.parties ? pair("Operators in the pool", `${summary.parties} · ${summary.endpoints} endpoint${summary.endpoints === 1 ? "" : "s"}`) : ""}
    ${state.rpcChecked ? pair("Checked", `Network ${state.rpcChecked.chainId} · ${new Date(state.rpcChecked.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`) : ""}
    ${summary.parties ? pair("Reads this session", String(totalReads)) : ""}
    ${
      summary.parties
        ? `<div class="note"><strong>${summary.isolating ? "Accounts are split across operators" : "One operator reads everything"}</strong>${
            summary.isolating
              ? `Each account is assigned to one of the ${summary.parties} operators below and is always read by that one. No single operator sees the set of accounts you switch between.`
              : "A pool of one is not isolation. Add an endpoint run by a different company and each account will be assigned to one of them."
          }<ul class="micro">${POOL_LIMITS.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul></div>`
        : ""
    }
    ${
      summary.parties
        ? `<div class="table-scroll"><table><thead><tr><th>Operator</th><th>Reads this session</th></tr></thead><tbody>${pool
            .map(
              (entry) =>
                `<tr><td>${esc(entry.host)}${entry.extras.length ? ` <span class="micro">+${entry.extras.length} more URL${entry.extras.length === 1 ? "" : "s"} at the same company, which answer for nothing</span>` : ""}${assigned && assigned.party === entry.party ? " " + chip("reads this account") : ""}</td><td>${state.rpcReads[entry.party] || 0}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : ""
    }
    <div class="field"><label for="rpc-endpoint">Your JSON-RPC endpoints, one per line</label><textarea id="rpc-endpoint" name="endpoint" rows="3" autocomplete="off" spellcheck="false" placeholder="https://… or http://localhost:8545" ${!state.vaultKey ? "disabled" : ""}>${esc(state.rpcEndpoints.join(NEWLINE))}</textarea></div>
    ${state.rpcError ? `<p class="live-form-error" role="alert">${esc(state.rpcError)}</p>` : ""}
    <div class="actions">${button(summary.parties ? "Check and save again" : "Check and use", "rpc-save", !state.vaultKey || state.busy ? "disabled" : "")}${summary.parties ? button("Remove all", "rpc-clear") : ""}</div>
    <p class="micro">${state.vaultKey ? "The endpoints are kept in the encrypted local vault, because a URL can carry your API key. They are never sent to Tera and never appear in the request log or its export — only their hosts are shown." : "Unlock encrypted local storage above to set endpoints. A URL can carry an API key, so they are only kept encrypted."}</p>
    <p class="micro">Only balance reads move. Signing, simulation, gas estimation and receipt checks stay with your wallet, because what your wallet signs has to be what your wallet saw. This wallet will not send any other method to your endpoint.</p>
    <p class="micro">If your endpoint fails, balances are not quietly read somewhere else — you are told, and nothing is sent to the provider you moved away from.</p>`;
}

async function saveBalanceEndpoint() {
  if (!state.vaultKey)
    throw new Error("Unlock encrypted local storage before setting a balance endpoint.");
  const input = document.getElementById("rpc-endpoint");
  state.rpcError = "";
  try {
    const pool = createPool(input?.value);
    if (!pool.length) throw new EndpointError("Enter the address of your node or endpoint.");
    // Every operator is checked before any of them is saved: one on the wrong
    // network would report balances that look real and are not, and it would
    // only do so for the accounts assigned to it, which is harder to notice.
    let id = 0;
    for (const entry of pool) id = await probeEndpoint(createRpc(entry.url), chainId);
    state.rpcEndpoints = poolUrls(pool);
    state.rpcChecked = { chainId: id, at: Date.now() };
    state.rpcReads = {};
    await persist();
    const summary = poolSummary(pool);
    state.notice = summary.isolating
      ? `Balance reads now go to ${summary.parties} operators. Each account is read by one of them, so no single one sees the accounts you switch between.`
      : `Balance reads now go to ${pool[0].host}. Your wallet extension's provider no longer sees which addresses you look at.`;
  } catch (error) {
    if (!(error instanceof EndpointError)) throw error;
    state.rpcError = error.message;
    render();
    return;
  }
  render();
  await loadBalances();
}

function settings() {
  return `<div class="content-grid"><section class="panel"><h2>Wallet connection</h2>${pair("Account", state.owner || "Not connected")}${pair("Network ID", chainId)}${pair("Wallet network", state.chain || "Not connected")}<div class="actions">${button(state.owner ? "Disconnect" : "Connect wallet", state.owner ? "disconnect" : "connect")}${button(state.hide ? "Show balances" : "Hide balances", "privacy")}</div></section><aside class="panel"><h2>Encrypted local storage</h2><p>${state.vaultKey ? "Drafts and device-side transaction records are encrypted in this browser." : "Unlock with a wallet signature to read and save encrypted drafts and device-side transaction records."}</p>${pair("Retention", `${state.vaultRetentionDays} days`)}<div class="field"><label for="vault-retention">Keep encrypted data for</label><select id="vault-retention" ${!state.owner ? "disabled" : ""}>${[7, 30, 90, 365].map((days) => `<option value="${days}" ${state.vaultRetentionDays === days ? "selected" : ""}>${days} days</option>`).join("")}</select></div><p class="micro">Unlocking signs a local storage message only. It does not approve a transaction or send a key to Tera.</p><div class="actions">${button(state.vaultKey ? "Vault unlocked" : "Unlock encrypted vault", "vault-unlock", !state.owner || state.vaultKey ? "disabled" : "")}${button("Clear encrypted data", "vault-clear", !state.owner ? "disabled" : "")}</div></aside><aside class="panel"><h2>Data retention</h2><p>Delete assistant messages, drafts, proposal versions, presets, and local request metadata. Confirmed transaction receipts stay available for audit history.</p><div class="actions">${button("Delete local assistant data", "assistant-local-clear", !state.owner ? "disabled" : "")}${button("Delete stored assistant data", "assistant-server-clear", !state.owner ? "disabled" : "")}</div></aside><section class="panel"><h2>Vault key lifecycle</h2>${vaultKeyPanel()}</section><aside class="panel"><h2>Balance reads</h2>${balanceReadsPanel()}</aside><section class="panel"><h2>Code transparency</h2>${codeTransparencyPanel()}</section><section class="panel panel-duress"><h2>Wipe this browser</h2>${duressPanel()}</section><aside class="panel"><h2>Guided private demo</h2><p>Run the wallet on sample data to show the privacy boundary without a real account. No request leaves the page and no transaction can be signed.</p><div class="actions">${state.demo ? button("Reset demo", "demo-reset") + button("Exit demo", "demo-exit") : button("Start guided demo", "demo-start")}</div></aside></div>`;
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
// The owner's endpoints are used only when at least one is configured and this
// is not the guided demo, which answers everything locally.
// The endpoint list is edited as one line per endpoint, so the separator is a
// named constant: a literal escape inside the template that renders the textarea
// is easy to mangle and hard to spot once it is.
const NEWLINE = String.fromCharCode(10);
const endpointPool = () => createPool(state.rpcEndpoints);
function ownEndpointActive() {
  return state.rpcEndpoints.length > 0 && !state.demo;
}
// Which operator reads for the connected account. Fixed for that account, so it
// is the same on every refresh and after a reload: picking a fresh one per read
// would walk every account across the whole pool and isolate nothing.
function readerFor(owner) {
  return assignEndpoint(endpointPool(), owner);
}
async function loadBalances(version = generation) {
  if (!state.provider || state.chain !== chainId) return;
  const provider = state.provider,
    owner = state.owner;
  const own = ownEndpointActive();
  // One operator answers for this account and never sees the others.
  const assigned = own ? readerFor(owner) : null;
  const read = assigned
    ? balanceReader(createRpc(assigned.url), ZERO_ADDRESS)
    : ({ assetAddress }) =>
        assetAddress === ZERO_ADDRESS
          ? provider.request({ method: "eth_getBalance", params: [owner, "latest"] })
          : provider.request({
              method: "eth_call",
              params: [
                { to: assetAddress, data: `0x70a08231${owner.slice(2).padStart(64, "0")}` },
                "latest",
              ],
            });
  const valid = state.assets.filter((a) => isAddress(a.address));
  const results = await Promise.allSettled(
    valid.map(async (a) => [
      a.address,
      formatUnits(await read({ assetAddress: a.address, owner }), a.decimals),
    ]),
  );
  if (version !== generation) return;
  if (assigned)
    state.rpcReads = {
      ...state.rpcReads,
      [assigned.party]: (state.rpcReads[assigned.party] || 0) + valid.length,
    };
  state.balances = Object.fromEntries(
    results.filter((r) => r.status === "fulfilled").map((r) => r.value),
  );
  const failure = results.find((r) => r.status === "rejected");
  if (failure || valid.length !== state.assets.length) {
    // A failing endpoint is never quietly replaced by the wallet's provider.
    // Doing so would send the owner's addresses to the party they moved away
    // from, while the panel still said otherwise.
    state.errors.balances =
      assigned && failure?.reason instanceof EndpointError
        ? `${errorMessage(failure.reason)} Balances were not read anywhere else. Fix the endpoint or remove it in Settings.`
        : "Some balances are unavailable because a contract address or network read could not be verified.";
  } else delete state.errors.balances;
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
function createProposal(symbol, draft = null) {
  connected();
  if (!state.assetsLoaded) throw new Error("Load the asset registry before preparing a proposal.");
  const assets = state.assets.filter((a) => isAddress(a.address) && a.status === "ACTIVE");
  dialog(
    "Prepare an exact action.",
    `<form id="proposal-form"><div class="field"><label for="proposal-asset">Asset</label><select id="proposal-asset" name="asset">${assets.map((a) => `<option value="${esc(a.symbol)}" ${a.symbol === symbol ? "selected" : ""}>${esc(a.symbol)} · ${esc(a.name)}</option>`).join("")}</select></div><div class="field"><label for="proposal-action">Action</label><select id="proposal-action" name="action"><option>TRANSFER</option><option>BUY</option><option>SELL</option></select></div><div class="field"><label id="proposal-amount-label" for="proposal-amount">Token amount</label><input id="proposal-amount" name="amount" inputmode="decimal" required placeholder="0.00" pattern="[0-9]+(\\.[0-9]+)?"></div><div class="field"><label for="proposal-recipient">Recipient</label><input id="proposal-recipient" name="recipient" placeholder="Required for transfers" autocomplete="off"></div><p id="proposal-help" class="micro"></p><p class="live-form-error" role="alert"></p><button class="btn primary">Run the checks ↗</button></form>`,
  );
  const form = document.getElementById("proposal-form");
  // A draft read out of a message fills the same fields the owner would type
  // into. Nothing is submitted: they still press the button and read the checks.
  if (draft && form) {
    const amount = form.querySelector('[name="amount"]');
    const recipient = form.querySelector('[name="recipient"]');
    if (amount && draft.amount) amount.value = draft.amount;
    if (recipient && draft.recipient) recipient.value = draft.recipient;
  }
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
// Check the wallet's own modules against the published manifest. It runs after
// the first render and never blocks the wallet: a failed check is information,
// not a reason to stop the owner reading their own screen.
async function checkIntegrity() {
  const manifestSigner = config.manifestSignerAddress || config.policySignerAddress || "";
  try {
    const response = await fetch("/tera/wallet/manifest.json", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(String(response.status));
    const manifest = await response.json();
    state.integrity = await verifyManifest(manifest, {
      // Read from the server rather than the cache: this reports what is being
      // served now, which is what an independent check would also see.
      fetchFile: async (path) => {
        const file = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!file.ok) throw new Error(String(file.status));
        return new Uint8Array(await file.arrayBuffer());
      },
      // Without a configured signer there is nothing to check a signature
      // against, so none is claimed.
      ...(manifestSigner
        ? { verifySignature: verifyBuildManifest, expectedSigner: manifestSigner }
        : {}),
    });
  } catch {
    state.integrity = {
      status: "unavailable",
      reason: "The build manifest could not be read from this site.",
      signed: false,
      signerOk: null,
      release: "",
      builtAt: "",
      checked: 0,
      matched: 0,
      problems: [],
      files: [],
    };
  }
  render();
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
    if (status.originChainId && status.originChainId !== 4663)
      throw new Error("Unexpected bridge origin.");
    if (status.destinationChainId && status.destinationChainId !== record.destinationChainId)
      throw new Error("Unexpected bridge destination.");
    record.status = status.status;
    record.destinationHashes = Array.isArray(status.txHashes) ? status.txHashes : [];
    record.error = status.failReason && status.failReason !== "N/A" ? status.failReason : "";
  } catch (error) {
    if (version === generation) record.error = errorMessage(error);
  }
  if (version === generation) {
    await persist();
    render();
  }
}

function reviewBridge(quote, input, version) {
  const fee = (entry) =>
    entry?.currency
      ? `${formatUnits(entry.amount, entry.currency.decimals)} ${entry.currency.symbol}`
      : "Unavailable";
  const sourceEth = input.originCurrency === "0x0000000000000000000000000000000000000000";
  const sourceSymbol = sourceEth ? "ETH" : "USDG";
  const sourceDecimals = sourceEth ? 18 : 6;
  const outSymbol = quote.input?.destination?.symbol || "destination token";
  const outDecimals = quote.input?.destination?.decimals ?? 6;
  const panel = dialog(
    "Review your bridge",
    `${pair("From", `Robinhood Chain · ${sourceSymbol}`)}${pair("To", `${quote.input?.destination?.name || "Destination"} · ${outSymbol}`)}${pair("Receiving address", input.recipient)}${pair(`${sourceSymbol} input`, formatUnits(input.amount, sourceDecimals))}${pair(`Expected ${outSymbol}`, formatUnits(quote.amountOut, outDecimals))}${pair(`Minimum ${outSymbol}`, formatUnits(quote.minimumAmountOut, outDecimals))}${pair("Relay fee (included in quote)", fee(quote.fees?.relayer))}${pair("Estimated network fee (additional)", fee(quote.fees?.gas))}${pair("Quote expires", new Date(quote.expiresAt).toLocaleTimeString())}<p class="micro">Relay handles delivery to this address. Source confirmation alone does not mean delivery is complete. Delivery or refund progress will appear below. ${state.vaultKey ? "Tracking is saved in your encrypted vault." : "Unlock the vault in Settings to save tracking across reloads."}</p><p id="bridge-progress" role="status"></p><button class="btn" id="bridge-sign">Approve bridge in wallet ↗</button>`,
  );
  const sign = panel.querySelector("#bridge-sign");
  sign.onclick = async () => {
    if (state.busy) return;
    sign.disabled = true;
    state.busy = true;
    let record;
    const progress = (message) => {
      panel.querySelector("#bridge-progress").textContent = message;
    };
    const active = () => {
      if (version !== generation || !panel.open)
        throw new Error("Wallet or review changed. Request a fresh bridge quote.");
    };
    try {
      active();
      correctNetwork();
      await sendBridge(
        state.provider,
        quote,
        input,
        active,
        async (step, hash) => {
          // Capture submitted hashes before any subsequent network operation.
          if (version !== generation) {
            progress(`Transaction submitted: ${hash}. Track Relay reference ${quote.requestId}.`);
            throw new Error(
              `Wallet changed after submission. Relay reference: ${quote.requestId}; transaction: ${hash}`,
            );
          }
          if (!record) {
            record = {
              ...input,
              requestId: quote.requestId,
              status: "waiting",
              createdAt: new Date().toISOString(),
            };
            state.bridges.unshift(record);
          }
          if (step === "deposit") {
            record.depositHash = hash;
            record.status = "depositing";
          } else record.approvalHash = hash;
          await persist();
        },
        progress,
      );
      progress("Deposit submitted. Tracking destination delivery.");
      await refreshBridge(record);
    } catch (error) {
      progress(`${errorMessage(error)} Request a fresh quote only if no deposit was submitted.`);
      if (record) {
        record.error = errorMessage(error);
        await persist();
      }
    } finally {
      state.busy = false;
      render();
    }
  };
}

setInterval(() => {
  if (route() !== "bridge" || state.busy || document.hidden) return;
  const record = state.bridges.find(
    (r) => r.depositHash && !["success", "failure", "refund"].includes(r.status),
  );
  if (record && !polling) {
    polling = true;
    void refreshBridge(record).finally(() => {
      polling = false;
    });
  }
}, 10000);

function bindForms() {
  const bridgeForm = document.getElementById("bridge-form");
  if (bridgeForm)
    bridgeForm.onsubmit = async (event) => {
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
      } finally {
        submit.disabled = false;
      }
    };
  const bridgeChain = document.getElementById("bridge-chain");
  const bridgeToken = document.getElementById("bridge-token");
  if (bridgeChain && bridgeToken)
    bridgeChain.onchange = () => {
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
      // Before minimisation, before the parser, before any engine. A refused
      // message must not be minimised: minimising keeps the original in this
      // page so the reply can be re-hydrated, and keeping it is the one thing
      // that must not happen to a recovery phrase.
      const verdict = inspectIngress(message);
      if (!verdict.safe) {
        refuseMessage(form, verdict);
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
    // Decided here, once, so the review dialog cannot show an owner what will
    // leave the device for a message that is never going to leave it.
    routing: routeMessage({
      mode,
      engine: state.engine,
      ready: engine.ready,
      supported: engineCapabilities().supported,
    }),
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

/**
 * Stop a message carrying a secret.
 *
 * The composer is cleared rather than left for the owner to clear, because the
 * value of a recovery phrase sitting in a textarea is that the next thing to
 * touch that box — an autofill, a screenshot, a support call over a shared
 * screen — still has it. Nothing is pushed into the chat and nothing is written
 * to the privacy log: an entry saying "a recovery phrase was blocked at 14:32"
 * is a smaller secret than the phrase, but it is still one, and the log is
 * exportable.
 */
function refuseMessage(form, verdict) {
  const box = form?.querySelector('[name="message"]');
  if (box) {
    box.value = "";
    box.focus();
  }
  state.ingress = verdict;
  state.notice = "";
  render();
}

/**
 * Attach a receipt to the turn that just finished.
 *
 * Written after the reply is on screen rather than before it is produced: a
 * receipt for an answer that never arrived would be a record of an intention.
 * The release and integrity status come from the page's own check, and the
 * receipt records them as the page's claim — `receipt.js` is what refuses to
 * present them as anything more.
 */
async function attachReceipt(
  message,
  { answeredBy, input, output, module: source, model, replaced },
) {
  try {
    const receipt = await createReceipt({
      answeredBy,
      input,
      output,
      release: state.integrity?.release || "",
      integrity: state.integrity?.status || "",
      module: source || "",
      model: model || "",
      replaced: replaced || 0,
    });
    message.receipt = receipt;
    message.transcript = { input, output };
  } catch {
    // A turn without a receipt is a turn without a receipt. It must never be a
    // turn without an answer.
  }
  render();
}

// What `parse.js` builds its answers out of. Every entry is the live export, so
// an answer cannot drift from the panel that shows the same text — rewording a
// limit in ohttp.js rewords the answer with it.
function answerSources() {
  return {
    gates: GATES,
    gateLabels: GATE_LABELS,
    gateExplanations: GATE_EXPLANATIONS,
    stages: STAGES,
    sideNotes: SIDE_NOTES,
    owner: OWNER,
    kindLabels: KIND_LABELS,
    proposeKeep: PROPOSE_KEEP,
    ohttpLimits: OHTTP_LIMITS,
    engineLimits: ENGINE_LIMITS,
    wipeLimits: WIPE_LIMITS,
    localOnly: LOCAL_ONLY,
    submissionModel: describeSubmission({ chainId }).model,
    submissionLimits: SUBMISSION_LIMITS,
    whyFixed: WHY_FIXED,
    readMethods: READ_METHODS,
  };
}

async function sendMessage(plan) {
  const { message, mode, keep, result } = plan;
  // Before either engine. A question this wallet can answer exactly from its
  // own code is answered that way, because the alternative is a paraphrase of
  // text that was written and reviewed carefully — and a request, or a model,
  // to produce it. Proposals are never handled here: they need the gates.
  if (mode !== "propose" && answeredLocally(message)) return;
  const routing = plan.routing || routeMessage({ mode, engine: state.engine });
  // An owner who chose the on-device engine does not get a network request
  // because the model was not ready. Nothing is sent, and the reason is shown.
  if (routing.blocked) {
    state.notice = routing.reason;
    render();
    return;
  }
  if (routing.engine === DEVICE) {
    await answerOnDevice(plan);
    return;
  }
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
    const served =
      response.reply ||
      response.explanation ||
      response.error ||
      "Review the proposal in Approvals.";
    const reply = { role: "assistant", text: restore(served) };
    state.chat.push(reply);
    // Committed to the skeleton that was sent and the reply as it came back,
    // before re-hydration. That pair is the boundary; what the owner typed and
    // what they read are both local and neither belongs in this record.
    void attachReceipt(reply, {
      answeredBy: RECEIPT_SERVICE,
      input: outgoing,
      output: served,
      replaced: minimised ? result.placeholders.length : 0,
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

/**
 * Answer a question in this tab.
 *
 * There is no `api` call in this function, and that is the feature rather than
 * an implementation detail. The message goes into a worker and a reply comes
 * back; no request is built, so there is nothing to minimise, nothing to seal,
 * and nothing for the request log to record. What is recorded is that a turn
 * was answered without a request, because a privacy centre that simply showed
 * nothing would be indistinguishable from a broken one.
 */
/**
 * Try the deterministic layer. Returns true when the message was fully dealt
 * with here, so `sendMessage` stops before it reaches an engine.
 *
 * A compose match is the interesting case. "Send 50 USDG to 0x…" is understood
 * completely, and the honest thing to do with that understanding is fill in the
 * form and stop — not skip to a transaction. Everything after this point is the
 * owner pressing the same buttons they always press, through the same checks.
 */
function answeredLocally(message) {
  const parsed = parseMessage(message);
  if (!parsed.matched) return false;

  if (parsed.kind === ANSWER) {
    const answer = respondLocally(parsed, answerSources());
    if (!answer) return false;
    state.chat.push({ role: "user", text: message, local: true });
    const reply = {
      role: "assistant",
      text: `**${answer.title}**

${answer.body}`,
      local: true,
      cites: answer.module,
      note: answer.note,
    };
    state.chat.push(reply);
    void attachReceipt(reply, {
      answeredBy: RECEIPT_CODE,
      input: message,
      output: reply.text,
      module: answer.module,
    });
    state.privacyLog = appendLog(state.privacyLog, {
      at: Date.now(),
      id: "parse-local",
      label: `Answered from this wallet's ${answer.module}`,
      purpose:
        "The question matched a fixed pattern with an exact answer in this wallet's own code. No model ran and no request was built.",
      method: "None",
      path: "No request",
      sent: [],
      withheld: ["The message you typed", "Your wallet address", "The network address you are on"],
      processors: ["Nobody. No request was made."],
      identifies: false,
      retention: "Nothing to retain anywhere else. The exchange is in this page session only.",
      onDevice: true,
    });
    render();
    return true;
  }

  if (parsed.kind === NAVIGATE) {
    navigate(parsed.page);
    return true;
  }

  if (parsed.kind === COMPOSE) {
    composeTransfer(parsed.slots);
    return true;
  }
  return false;
}

/**
 * Carry an understood transfer into the composer. It does not prepare, submit
 * or sign anything: the owner still presses Prepare, still reads the five
 * checks, and still approves in their own wallet.
 */
function composeTransfer(slots) {
  const asset = state.assets.find(
    (entry) => entry.symbol.toUpperCase() === slots.symbol.toUpperCase(),
  );
  if (slots.symbol && state.assetsLoaded && !asset) {
    state.chat.push({
      role: "assistant",
      text: `There is no **${esc(slots.symbol)}** in the asset registry, so nothing was filled in. Open the registry to see what this wallet supports.`,
      local: true,
      note: "Read from your message on this device. No model ran and no request was made.",
    });
    render();
    return;
  }
  try {
    // The same dialog the owner opens from the registry, with the parts of
    // their sentence already in it.
    createProposal(asset?.symbol, { amount: slots.amount, recipient: slots.recipient });
    state.chat.push({
      role: "assistant",
      text: `Opened the prepare form with **${slots.amount}${asset ? ` ${asset.symbol}` : ""}** to \`${slots.recipient}\` filled in.

Nothing has been prepared or sent. Check it, run the five checks, and approve in your own wallet.`,
      local: true,
      note: "Read from your message on this device. No model ran and no request was made.",
    });
  } catch (error) {
    state.chat.push({
      role: "assistant",
      text: `${errorMessage(error)}

Your message was understood on this device and was not sent anywhere.`,
      local: true,
    });
  }
  render();
}

async function answerOnDevice(plan) {
  const { message } = plan;
  const version = generation;
  state.chat.push({ role: "user", text: message, device: true });
  state.busy = true;
  render();
  try {
    const raw = await engine.ask(message);
    if (version !== generation) return;
    // Screened before it is rendered. A small model answers "what is my
    // balance?" with a number it made up, and the owner has no way to tell.
    const screened = screenReply(raw);
    const reply = {
      role: "assistant",
      text: screened.text,
      device: true,
      withheld: screened.withheld,
    };
    state.chat.push(reply);
    // The receipt commits to what the model actually produced, not to the
    // screened stand-in. A withheld reply is a fact about this turn, and a
    // receipt that hashed the refusal notice instead would hide it.
    void attachReceipt(reply, {
      answeredBy: RECEIPT_DEVICE,
      input: message,
      output: raw,
      model: state.engineInfo?.model || "",
    });
    state.privacyLog = appendLog(state.privacyLog, {
      at: Date.now(),
      id: "engine-device",
      label: "Assistant question answered on this device",
      purpose:
        "The message was answered by the model running in this tab. No request was built, so nothing was sent to Tera, to a relay, or to a model provider.",
      method: "None",
      path: "No request",
      retention:
        "Nothing to retain anywhere else. The exchange is in this page session only and is cleared on reload.",
      sent: [],
      withheld: ["The message you typed", "Your wallet address", "The network address you are on"],
      processors: ["Nobody. No request was made."],
      identifies: false,
      onDevice: true,
    });
  } catch (error) {
    if (version === generation) {
      state.chat.push({
        role: "assistant",
        text: `${errorMessage(error)}

Nothing was sent to Tera in its place.`,
        device: true,
      });
    }
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
      const stored = readKeyInfo();
      if (stored?.passphrase) {
        passphrasePrompt(
          "Unlock the vault",
          "<p>This vault needs its passphrase as well as your wallet signature.</p>",
          async (passphrase) => {
            await unlockEncryptedStorage(passphrase);
            closeDialog();
            state.notice = "Encrypted local storage unlocked.";
            render();
          },
        );
      } else {
        await unlockEncryptedStorage();
        state.notice = "Encrypted local storage unlocked.";
        render();
      }
    }
    if (action === "duress-wipe") duressWipeDialog();
    if (action === "vault-rotate") rotateVaultKeyDialog();
    if (action === "vault-rotate-confirm") {
      closeDialog();
      await rotateVaultKey();
      state.notice = `Vault key rotated to epoch ${state.vaultKeyEpoch}. The previous signature no longer opens it.`;
      render();
    }
    if (action === "vault-passphrase") passphraseDialog();
    if (action === "vault-passphrase-set")
      passphrasePrompt(
        "Set a new passphrase",
        "<p>The vault key is rotated and the new passphrase takes effect with it. Your wallet will ask you to sign for the new epoch.</p>",
        async (passphrase) => {
          await rotateVaultKey({ passphrase, keepPassphrase: true });
          closeDialog();
          state.notice = "The vault passphrase was replaced and the key rotated.";
          render();
        },
      );
    if (action === "vault-passphrase-remove")
      confirmDialog(
        {
          title: "Remove the vault passphrase?",
          lead: "The vault key is rotated and the passphrase stops being part of it. From then on your wallet signature alone opens this vault.",
          consequence:
            "Anyone who can sign with this wallet can open the vault. The passphrase is what stands between a borrowed or unlocked wallet and everything stored here.",
          goes: [
            "The passphrase is no longer asked for, on this device or any other.",
            "The vault key is rotated, so the old key cannot open the new contents.",
            "Your wallet asks you to sign once, for the new epoch.",
          ],
          keeps: [
            "Nothing stored in the vault is deleted or changed.",
            "Recovery shares you have already handed out keep working.",
            "You can set a passphrase again at any time.",
          ],
          confirmLabel: "Remove the passphrase",
          cancelLabel: "Keep the passphrase",
        },
        async () => {
          closeDialog();
          await rotateVaultKey({ keepPassphrase: false });
          state.notice =
            "The passphrase was removed. This vault now opens with your wallet signature alone.";
          render();
        },
      );
    if (action === "vault-export") exportVaultDialog();
    if (action === "vault-import") importVaultDialog();
    if (action === "vault-recovery-create") createRecoveryDialog();
    if (action === "vault-recovery-use") useRecoveryDialog();
    if (action === "recovery-copy") {
      if (!recoveryState.shares.length) throw new Error("There are no shares to copy.");
      await navigator.clipboard.writeText(recoveryState.shares.join("\n"));
      state.notice = "Recovery shares copied. Give each one to a different holder.";
    }
    if (action === "recovery-download") {
      if (!recoveryState.blob) throw new Error("There is no recovery file to download.");
      downloadJson(recoveryState.blob, `tera-vault-recovery-${Date.now()}.json`);
    }
    if (action === "vault-clear") {
      clearEncryptedStorage();
      state.notice = "Encrypted drafts and device-side records were cleared.";
      render();
    }
    if (action === "assistant-local-clear")
      confirmDialog(
        {
          title: "Delete local assistant data?",
          lead: "Everything the assistant has left on this device is removed. No request is made and nothing is told to Tera.",
          consequence:
            "This cannot be undone from here. A turn answered on this device exists nowhere else, so deleting it ends it.",
          goes: [
            "Assistant messages and replies held in this browser.",
            "Drafts and saved proposal versions.",
            "Your policy simulator presets.",
            "The local request log behind the privacy status centre.",
          ],
          keeps: [
            "Records Tera already holds. Deleting those is the separate control below.",
            "Confirmed receipts and anything already on chain.",
            "Your vault, its passphrase, and your recovery shares.",
          ],
          confirmLabel: "Delete from this device",
          cancelLabel: "Keep it",
        },
        async () => {
          clearLocalAssistantData();
          await persist();
          closeDialog();
          state.notice = "Local assistant data was deleted from this device.";
          render();
        },
      );
    if (action === "assistant-server-clear")
      confirmDialog(
        {
          title: "Delete the data Tera holds?",
          lead: "Your wallet is asked to sign a request telling Tera's service to delete the assistant data stored against your account.",
          consequence:
            "Confirmed receipts are not deleted. Tera keeps those because they record actions you approved, and a record you can delete is not a record.",
          goes: [
            "Unconfirmed proposal data stored by the service.",
            "Assistant request data held against your account.",
          ],
          keeps: [
            "Confirmed receipts for actions you approved.",
            "Anything already written to the chain, which nobody can delete.",
            "Local data on this device. That is the separate control above.",
          ],
          confirmLabel: "Sign and delete",
          cancelLabel: "Cancel",
        },
        async () => {
          closeDialog();
          await deleteServerAssistantData();
          render();
        },
      );
    if (action === "minimise-toggle") {
      state.minimise = target.checked;
      // Updated in place so the message being composed is not thrown away.
      const hint = document.getElementById("minimise-hint");
      if (hint) hint.textContent = minimiseHint();
    }
    if (action === "engine-select") {
      state.engine = target.value === DEVICE ? DEVICE : SERVICE;
      render();
    }
    if (action === "engine-load") {
      try {
        await engine.prepare();
      } catch {
        /* The failure is already on the panel; nothing was sent either way. */
      }
    }
    if (action === "engine-unload")
      confirmDialog(
        {
          title: "Remove the on-device model?",
          lead: "The model is torn down and its weights are cleared from this browser's cache.",
          // Recoverable, unlike the other three: the weights can be fetched
          // again. The note is the plain one, and the cost is stated as a cost
          // rather than as a warning.
          heavy: false,
          consequence:
            "Using the on-device engine again means downloading the weights again, which is a large transfer on a metered or slow connection.",
          goes: [
            "The worker running the model in this tab.",
            "The cached weights, freeing the space they take.",
            "The record that this build's model was verified in full.",
          ],
          keeps: [
            "Your messages, receipts and everything else stored here.",
            "The option to load it again whenever you want it.",
          ],
          confirmLabel: "Remove the model",
          cancelLabel: "Keep it loaded",
        },
        async () => {
          closeDialog();
          await unloadEngine();
        },
      );
    if (action === "ingress-dismiss") {
      state.ingress = null;
      render();
    }
    if (action === "minimise-review-toggle") state.minimiseReview = target.checked;
    if (action === "minimise-send" || action === "minimise-send-raw") {
      const plan = pendingMessage;
      pendingMessage = null;
      closeDialog();
      if (plan) await sendMessage({ ...plan, minimised: action === "minimise-send" });
    }
    if (action === "integrity-recheck") {
      state.integrity = null;
      render();
      await checkIntegrity();
    }
    if (action === "integrity-download") {
      const response = await fetch("/tera/wallet/manifest.json", { cache: "no-store" });
      downloadJson(await response.json(), `tera-build-manifest-${Date.now()}.json`);
    }
    if (action === "rpc-save") await saveBalanceEndpoint();
    if (action === "rpc-clear") {
      state.rpcEndpoints = [];
      state.rpcChecked = null;
      state.rpcError = "";
      state.rpcReads = {};
      await persist();
      state.notice =
        "Balance reads are going through your wallet extension's provider again. It sees each address you look at.";
      render();
      await loadBalances();
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
    if (action === "receipt-open") await openReceipt(target.dataset.index);
    if (action === "receipt-sign") {
      const message = state.chat[Number(target.dataset.index)];
      if (!message?.receipt) return;
      connected();
      const owner = state.owner;
      const signed = await signReceipt(message.receipt, {
        signer: owner,
        // The provider is handed the exact text `receipt.js` composed. Nothing
        // between here and the wallet window may alter it, or the signature
        // would cover something the owner did not read.
        sign: (text) =>
          state.provider.request({
            method: "personal_sign",
            params: [
              `0x${[...new TextEncoder().encode(text)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`,
              owner,
            ],
          }),
      });
      message.receipt = signed;
      closeDialog();
      await openReceipt(target.dataset.index);
      return;
    }
    if (action === "receipt-export") {
      const index = Number(target.dataset.index);
      // The confirmation is the point, so it is the wallet's own dialog rather
      // than a browser prompt: the same surface, wording and spacing as every
      // other decision here, and room to show what the file actually holds.
      if (state.chat[index]?.receipt) receiptExportDialog(index);
    }
    if (action === "receipt-export-confirm") {
      const message = state.chat[Number(target.dataset.index)];
      if (message?.receipt) {
        downloadJson(
          receiptBundle(message.receipt, message.transcript || {}),
          `tera-receipt-${message.receipt.shortRef}.json`,
        );
        closeDialog();
        state.notice = `Receipt ${message.receipt.shortRef} was saved to your downloads. The message and the reply are in that file in full.`;
        render();
      }
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
void checkIntegrity();
