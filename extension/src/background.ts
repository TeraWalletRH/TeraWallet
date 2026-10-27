// The extension's background worker: the one place that decides what a site
// gets. Sites reach it through content.ts; the popup and the approval window
// reach it through runtime messages. The rules are in core/dapp-connect.js
// (connecting), core/dapp-sign.js (signatures) and core/dapp-send.js
// (transactions).
//
// Chrome stops this worker when idle and starts it again on the next message,
// so nothing that matters lives only in memory: the wallet and the connected
// sites are in storage. A connection request waiting on the owner does live
// in memory (as does a signature request), kept awake by the approval window,
// and if the worker restarts
// anyway the site gets a clear error and the window says the request expired.

import {
  CHAIN_HEX,
  CHAIN_ID,
  ERRORS,
  accountsFor,
  checkRequest,
  classify,
  grant,
  listSites,
  passwordWait,
  permissionsFor,
  revoke,
  rpcError,
  siteOrigin,
  switchChain,
} from "../../public/tera/core/dapp-connect.js";
import { SIGNABLE, refusal, signRequest } from "../../public/tera/core/dapp-sign.js";
import * as phishing from "./phishing";
import {
  describe,
  feeCheck,
  formatEth,
  formatUnits,
  readTransaction,
} from "../../public/tera/core/dapp-send.js";
import { keccak256 } from "viem";
import { KNOWN_SPENDERS } from "../../public/tera/core/approvals.js";
import { append, entryFor } from "../../public/tera/core/signature-log.js";
import { createRotation, isNodeFault, nodeList } from "../../public/tera/core/rpc-rotation.js";
import {
  NATIVE,
  buildTransfer,
  checkAmount,
  checkRecipient,
  cleanRegistry,
  toUnits,
} from "../../public/tera/core/wallet-send.js";
import { API, PUBLIC_RPCS, RPC, sources } from "../../android/src/config";
import {
  PERMIT2,
  stakingSignature,
  stepLabel,
  swapPair,
  swapReview,
  tradable,
} from "../../public/tera/core/wallet-swap.js";
import {
  activeEpoch,
  addPending,
  creditOutcome,
  creditRequest,
  depositIssue,
  fixedReward,
  flexibleApr,
  pendingFor,
  resolvePending,
} from "../../public/tera/core/staking.js";
import { isSlippageBps } from "../../public/tera/core/slippage.js";
import { policyFor } from "../../android/src/policy";
import { proposalVerdicts, verifyProposal } from "../../android/src/proposals";
import {
  createVault,
  isWatch,
  openSecret,
  signer,
  watchVault,
  WATCH_ONLY,
  type Vault,
} from "./vault";
import { OWN } from "./shared";
import { isSealed } from "../../android/src/handoff";

type Sites = Record<string, { accounts: string[]; connectedAt: number }>;
type RpcErr = { code: number; message: string; data?: unknown };
type SignRequest = Exclude<ReturnType<typeof signRequest>, { error: unknown }>;
type Tx = { from: string; to: string; value: string; data: string };
// A transaction as the approval window shows it. Amounts are strings so the
// whole thing passes through runtime messaging unchanged.
type SendRequest = {
  tx: Tx;
  described: ReturnType<typeof describe>;
  fee?: { gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; maxFee: string };
  // When the chain was read: a fee worked out minutes ago is worked out again.
  preparedAt: number;
  // Set when the transaction can't go ahead: it would fail, or can't be paid for.
  blocked?: string;
  // A stake: remembered once sent, until Tera's service credits it.
  stake?: { kind: "fixed" | "flexible"; termDays?: number; epochId?: string; amount: string };
};
// A swap as the review window shows it: Tera's proposal, checked on this
// device by android/src/proposals.ts, and the steps it comes down to.
type SwapRequest = {
  params: { asset: string; side: "BUY" | "SELL"; amount: string; slippageBps: number };
  proposal: unknown;
  steps: { to: string; data: string; value: string }[];
  labels: string[];
  review: ReturnType<typeof swapReview>;
  checks: string;
  preparedAt: number;
  // Set while the steps go out, for the window to show.
  progress?: string;
  blocked?: string;
};
// A claim, unstake or unlock: text Tera's service has the wallet sign,
// checked against the text expected for it, and where the signature goes.
type StakeSignRequest = {
  title: string;
  rows: [string, string][];
  message: string;
  submit: { path: string; body: Record<string, unknown> };
};
type AnyRequest = SignRequest | SendRequest | SwapRequest | StakeSignRequest;
type Sent = {
  hash: string;
  at: number;
  site: string;
  title: string;
  recipient: string;
  // Who sent it and with which nonce: a later transaction mined with the same
  // nonce means this one never will be. Missing on entries from 0.3.0.
  from?: string;
  nonce?: number;
  status: "broadcasting" | "pending" | "confirmed" | "failed" | "unknown" | "dropped";
};

// What explanations name: the tokens and contracts Tera knows. Tokens are
// the wallet's own (USDG, ETH) plus Tera's registry once it has been read.
type Asset = { symbol: string; name: string; address: string; decimals: number; priceAs?: string };
const PINNED: Asset[] = sources.map((s) => ({
  symbol: s.symbol,
  name: s.symbol === "ETH" ? "Ether" : "Global Dollar",
  address: s.address.toLowerCase(),
  decimals: s.decimals,
}));
const tokenMap = (assets: Asset[]) =>
  Object.fromEntries(
    assets
      .filter((a) => a.address !== NATIVE)
      .map((a) => [a.address, { symbol: a.symbol, decimals: a.decimals }]),
  );
const tokens = async () => tokenMap(await registry());
const SPENDERS = Object.fromEntries(
  Object.entries(KNOWN_SPENDERS).map(([address, [en]]) => [address, en]),
);

// The wallet's storage is for this worker and the extension's own pages,
// never for content scripts running inside websites.
void chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });

const load = async () => {
  const {
    vault = null,
    sites = {},
    failures = 0,
    failedAt = 0,
  } = await chrome.storage.local.get(["vault", "sites", "failures", "failedAt"]);
  return {
    vault: vault as Vault | null,
    sites: sites as Sites,
    failures: failures as number,
    failedAt: failedAt as number,
  };
};

// ---------------------------------------------------------------- sites ----

const ports = new Map<chrome.runtime.Port, string>();

function broadcast(origin: string | null, event: string, data: unknown) {
  for (const [port, portOrigin] of ports)
    if (origin === null || portOrigin === origin) {
      try {
        port.postMessage({ event, data });
      } catch {
        // That tab closed between the lookup and the send.
      }
    }
}

async function setSites(sites: Sites) {
  await chrome.storage.local.set({ sites });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tera-provider" || port.sender?.id !== chrome.runtime.id)
    return port.disconnect();
  // Chrome says which page this is. A page's own claims are never consulted.
  const origin = siteOrigin(port.sender?.url);
  if (!origin || (port.sender?.origin && port.sender.origin !== origin)) return port.disconnect();
  ports.set(port, origin);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(async (message) => {
    const id = message?.id;
    const method = message?.request?.method;
    try {
      const result = await handle(origin, message?.request);
      port.postMessage({ id, method, result });
    } catch (error) {
      const e = error as RpcErr;
      port.postMessage({
        id,
        method,
        error:
          typeof e?.code === "number"
            ? e
            : rpcError(ERRORS.internal, "Something went wrong in Tera Wallet."),
      });
    }
  });
});

async function handle(origin: string, request: { method: string; params?: unknown }) {
  const invalid = checkRequest(request);
  if (invalid) throw invalid;
  const { method, params } = request;
  const { sites, vault } = await load();
  // A watched wallet connects and reads like any other, and refuses to sign
  // before any window opens.
  const kind = classify(method);
  if ((kind === "signing" || kind === "send") && isWatch(vault))
    throw rpcError(ERRORS.unauthorized, WATCH_ONLY);
  switch (kind) {
    case "chain":
      return CHAIN_HEX;
    case "accounts": {
      const accounts = accountsFor(sites, origin);
      return method === "eth_coinbase" ? (accounts[0] ?? null) : accounts;
    }
    case "connect": {
      const accounts = accountsFor(sites, origin).length
        ? accountsFor(sites, origin)
        : await askToConnect(origin);
      return method === "wallet_requestPermissions"
        ? permissionsFor((await load()).sites, origin)
        : accounts;
    }
    case "permissions":
      return permissionsFor(sites, origin);
    case "revoke":
      await setSites(revoke(sites, origin));
      broadcast(origin, "accountsChanged", []);
      return null;
    case "switch": {
      const refused = switchChain(params);
      if (refused) throw refused;
      return null;
    }
    case "add":
      throw rpcError(
        ERRORS.unsupported,
        "Tera Wallet only works on Robinhood Chain, so it doesn't add networks.",
      );
    case "read":
      return read(method, Array.isArray(params) ? params : []);
    case "signing": {
      if (!SIGNABLE.has(method)) throw refusal(method);
      const request = signRequest(method, params, {
        origin,
        accounts: accountsFor(sites, origin),
        tokens: await tokens(),
        spenders: SPENDERS,
      });
      if ("error" in request) throw request.error;
      return askToSign(origin, request as SignRequest);
    }
    case "send": {
      const read = readTransaction(params, { accounts: accountsFor(sites, origin) });
      if (read.error) throw read.error;
      cooling(origin);
      oneAtATime(origin);
      // The site's place is held while the chain is read, so requests fired
      // together can't all slip past oneAtATime and open a window each.
      preparing.add(origin);
      let prepared: SendRequest;
      try {
        prepared = await prepare(read.tx as Tx);
      } finally {
        preparing.delete(origin);
      }
      return ask("send", origin, prepared);
    }
    default:
      throw rpcError(ERRORS.unsupported, `Tera Wallet doesn't support ${method}.`);
  }
}

// ------------------------------------------------------------ approvals ----

type Approval = {
  kind: "connect" | "sign" | "send" | "swap" | "stake-sign";
  origin: string;
  request?: AnyRequest;
  resolve: (value: unknown) => void;
  reject: (error: RpcErr) => void;
  promise: Promise<unknown>;
  windowId?: number;
  // Set while an approved request is being signed or sent, so closing the
  // window then doesn't tell the site "declined" about something that went
  // out, and a second Confirm can't send it twice.
  busy?: boolean;
  closed?: boolean;
};
const approvals = new Map<string, Approval>();
const preparing = new Set<string>();
// When each site was last declined. A site that asks again at once gets an
// error, not another window in the owner's face.
const declinedAt = new Map<string, number>();
const COOL_DOWN = 10_000;

function cooling(origin: string) {
  if (Date.now() - (declinedAt.get(origin) ?? 0) < COOL_DOWN)
    throw rpcError(
      ERRORS.rejected,
      "You just declined this site. It can ask again in a few seconds.",
    );
}

function ask(kind: Approval["kind"], origin: string, request?: AnyRequest) {
  const id = crypto.randomUUID();
  let resolve!: Approval["resolve"];
  let reject!: Approval["reject"];
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const approval: Approval = { kind, origin, request, resolve, reject, promise };
  approvals.set(id, approval);
  void openWindow(id).then((windowId) => {
    if (windowId === undefined)
      finish(id, undefined, rpcError(ERRORS.internal, "Couldn't open the Tera window."));
    else approval.windowId = windowId;
  });
  return promise;
}

async function askToConnect(origin: string) {
  // A site asking twice while the first window is open gets the same window.
  for (const approval of approvals.values())
    if (approval.kind === "connect" && approval.origin === origin)
      return approval.promise as Promise<string[]>;
  // Checked before the cool-down and before any window opens: a known-phishing
  // site gets no approval window at all, not even one the owner could tap
  // through by habit.
  if (await phishing.isKnownPhishing(origin))
    throw rpcError(
      ERRORS.unauthorized,
      "Tera has refused to connect: this site is on a known phishing list.",
    );
  cooling(origin);
  return ask("connect", origin) as Promise<string[]>;
}

// One signature or transaction at a time per site, so a page can't bury the
// owner in windows.
function oneAtATime(origin: string) {
  const busy =
    preparing.has(origin) ||
    [...approvals.values()].some((a) => a.kind !== "connect" && a.origin === origin);
  if (busy)
    throw rpcError(
      ERRORS.pending,
      origin === OWN
        ? "A send is already open in a Tera window. Confirm or cancel it first."
        : "A request from this site is already open in Tera.",
    );
}

function askToSign(origin: string, request: SignRequest) {
  cooling(origin);
  oneAtATime(origin);
  return ask("sign", origin, request);
}

async function openWindow(id: string) {
  const width = 380;
  const height = 640;
  let left: number | undefined;
  let top: number | undefined;
  try {
    const current = await chrome.windows.getLastFocused();
    if (current.left !== undefined && current.width !== undefined)
      left = current.left + current.width - width - 16;
    if (current.top !== undefined) top = current.top + 72;
  } catch {
    // No browser window to sit beside; Chrome places the window itself.
  }
  try {
    const created = await chrome.windows.create({
      url: chrome.runtime.getURL(`approve.html?id=${id}`),
      type: "popup",
      width,
      height,
      left,
      top,
      focused: true,
    });
    return created?.id;
  } catch {
    return undefined;
  }
}

function finish(id: string, result: unknown, error?: RpcErr) {
  const approval = approvals.get(id);
  if (!approval) return;
  approvals.delete(id);
  if (error?.code === ERRORS.rejected) declinedAt.set(approval.origin, Date.now());
  if (error) approval.reject(error);
  else approval.resolve(result);
  if (approval.windowId !== undefined) chrome.windows.remove(approval.windowId).catch(() => {});
}

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, approval] of approvals)
    if (approval.windowId === windowId) {
      approval.windowId = undefined;
      if (approval.busy) approval.closed = true;
      else finish(id, undefined, rpcError(ERRORS.rejected, "The request was declined."));
    }
});

/** Runs an approved request once at a time; see Approval.busy. */
async function exclusively<T>(id: string, approval: Approval, work: () => Promise<T>) {
  if (approval.busy) return { error: "Tera is already working on this." };
  approval.busy = true;
  try {
    return await work();
  } finally {
    approval.busy = false;
    // The window was closed meanwhile and nothing finished the request.
    if (approval.closed && approvals.has(id))
      finish(id, undefined, rpcError(ERRORS.rejected, "The request was declined."));
  }
}

// ----------------------------------------------------------- passwords ----

async function tryPassword(
  password: string,
): Promise<{ ok: true; vault: Vault; secret: string } | { ok: false; error: string }> {
  const { vault, failures, failedAt } = await load();
  if (!vault) return { ok: false, error: "There's no wallet in this browser yet." };
  if (isWatch(vault)) return { ok: false, error: WATCH_ONLY };
  const wait = failedAt + passwordWait(failures) - Date.now();
  if (wait > 0)
    return { ok: false, error: `Too many wrong tries. Wait ${Math.ceil(wait / 1000)}s.` };
  const secret = await openSecret(vault, String(password ?? ""));
  if (secret) {
    await chrome.storage.local.set({ failures: 0, failedAt: 0 });
    return { ok: true, vault, secret };
  }
  await chrome.storage.local.set({ failures: failures + 1, failedAt: Date.now() });
  const next = passwordWait(failures + 1);
  return {
    ok: false,
    error: next ? `Wrong password. Wait ${next / 1000}s before trying again.` : "Wrong password.",
  };
}

// ------------------------------------------------------- extension pages ----

// The web wallet handing over a wallet it just made (android/src/handoff.ts).
// Chrome delivers these only from the sites in externally_connectable, and
// the sender is checked against that list again here. One is kept only when
// a welcome tab is waiting for that very session, and only in session
// storage (memory) until that tab, the one holding the key, takes it.
const handoffOrigins = () =>
  (chrome.runtime.getManifest().externally_connectable?.matches ?? []).map((m) =>
    m.replace(/\/\*$/, ""),
  );

chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  if (!handoffOrigins().includes(origin) || message?.type !== "tera:handoff") return false;
  if (!isSealed(message.sealed)) {
    reply({ error: "That wallet didn't arrive in one piece. Try again." });
    return false;
  }
  void (async () => {
    const { handoffWaiting } = await chrome.storage.session.get("handoffWaiting");
    if (handoffWaiting !== message.sealed.session)
      return reply({
        error: "Tera for Chrome isn't waiting for this wallet. Start again from the extension.",
      });
    if ((await load()).vault) return reply({ error: "Tera for Chrome already has a wallet." });
    await chrome.storage.session.set({ handoff: message.sealed });
    reply({ ok: true });
  })().catch(() => reply({ error: "Tera for Chrome couldn't take the wallet. Try again." }));
  return true;
});

// A fresh install opens the welcome tab, as most wallets do; an update doesn't.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install" || (await load()).vault) return;
  await chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Only the extension's own pages, never a content script inside a site.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL("")))
    return false;
  page(message)
    .then(reply)
    .catch((error) => reply({ error: String(error?.message || error) }));
  return true;
});

type PageMessage = {
  type?: string;
  id?: string;
  secret?: unknown;
  address?: unknown;
  password?: unknown;
  origin?: unknown;
  asset?: unknown;
  to?: unknown;
  amount?: unknown;
  side?: unknown;
  slippageBps?: unknown;
  term?: unknown;
  kind?: unknown;
  epochId?: unknown;
  lockId?: unknown;
  consent?: unknown;
};

const NEEDS_KEY = new Set(["wallet:send", "wallet:swap", "wallet:stake", "wallet:stake-sign"]);

async function page(message: PageMessage) {
  if (NEEDS_KEY.has(String(message?.type)) && isWatch((await load()).vault))
    return { error: WATCH_ONLY };
  switch (message?.type) {
    case "ping":
      return { ok: true };
    case "state": {
      const { vault, sites } = await load();
      const { signatures } = await chrome.storage.local.get("signatures");
      return {
        address: vault?.address ?? null,
        watch: isWatch(vault),
        sites: listSites(sites),
        signatures: ((signatures as { items?: unknown[] } | undefined)?.items ?? []).slice(0, 10),
        transactions: (await refreshSent()).slice(0, 10),
      };
    }
    case "wallet:add": {
      if ((await load()).vault)
        return { error: "This browser already has a wallet. Remove it first." };
      const vault = await createVault(String(message.secret ?? ""), String(message.password ?? ""));
      await chrome.storage.local.set({ vault, failures: 0, failedAt: 0 });
      return { address: vault.address };
    }
    case "wallet:watch": {
      if ((await load()).vault)
        return { error: "This browser already has a wallet. Remove it first." };
      const vault = watchVault(String(message.address ?? ""));
      await chrome.storage.local.set({ vault, failures: 0, failedAt: 0 });
      return { address: vault.address };
    }
    case "wallet:remove": {
      // A watched wallet has no password: there's nothing in it to protect.
      if (!isWatch((await load()).vault)) {
        const tried = await tryPassword(String(message.password ?? ""));
        if (!tried.ok) return { error: tried.error };
      }
      await chrome.storage.local.remove([
        "vault",
        "sites",
        "failures",
        "failedAt",
        "signatures",
        "transactions",
      ]);
      broadcast(null, "accountsChanged", []);
      return { ok: true };
    }
    case "site:disconnect": {
      const origin = String(message.origin ?? "");
      await setSites(revoke((await load()).sites, origin));
      broadcast(origin, "accountsChanged", []);
      return { ok: true };
    }
    case "wallet:balances":
      return balances();
    case "wallet:send":
      return walletSend(message);
    case "wallet:swap":
      return walletSwap(message);
    case "wallet:staking":
      return staking();
    case "wallet:stake":
      return walletStake(message);
    case "wallet:stake-sign":
      return walletStakeSign(message);
    case "approval:swap": {
      const id = String(message.id);
      const approval = approvals.get(id);
      if (!approval || approval.kind !== "swap" || !approval.request) return { expired: true };
      return exclusively(id, approval, () => runSwap(id, approval, message));
    }
    case "approval:stake-sign": {
      const id = String(message.id);
      const approval = approvals.get(id);
      if (!approval || approval.kind !== "stake-sign" || !approval.request)
        return { expired: true };
      return exclusively(id, approval, async () => {
        const request = approval.request as StakeSignRequest;
        const tried = await tryPassword(String(message.password ?? ""));
        if (!tried.ok) return { error: tried.error };
        const signature = await signer(tried.secret).signMessage({ message: request.message });
        try {
          await api(request.submit.path, { ...request.submit.body, signature });
        } catch (error) {
          return { error: String((error as Error).message || error) };
        }
        finish(id, signature);
        return { ok: true };
      });
    }
    case "approval:get": {
      const approval = approvals.get(String(message.id));
      if (!approval) return { expired: true };
      const { vault } = await load();
      return {
        kind: approval.kind,
        origin: approval.origin,
        address: vault?.address ?? null,
        watch: isWatch(vault),
        request: approval.request,
      };
    }
    case "approval:connect": {
      const approval = approvals.get(String(message.id));
      if (!approval || approval.kind !== "connect") return { expired: true };
      // Connecting a watched wallet shares only its address, so no password.
      const { vault } = await load();
      let accounts: string[];
      if (isWatch(vault)) accounts = [vault.address];
      else {
        const tried = await tryPassword(String(message.password ?? ""));
        if (!tried.ok) return { error: tried.error };
        accounts = [tried.vault.address];
      }
      await setSites(grant((await load()).sites, approval.origin, accounts));
      // Other tabs of the same site hear about it; this one gets the answer.
      broadcast(approval.origin, "accountsChanged", accounts);
      finish(String(message.id), accounts);
      return { ok: true };
    }
    case "approval:sign": {
      const id = String(message.id);
      const approval = approvals.get(id);
      if (!approval || approval.kind !== "sign" || !approval.request) return { expired: true };
      return exclusively(id, approval, async () => {
        // The site may have been disconnected while the window was open.
        if (!accountsFor((await load()).sites, approval.origin).length) {
          finish(id, undefined, rpcError(ERRORS.unauthorized, "The site was disconnected."));
          return { expired: true };
        }
        const tried = await tryPassword(String(message.password ?? ""));
        if (!tried.ok) return { error: tried.error };
        const request = approval.request as SignRequest;
        const signature = await sign(tried.secret, request);
        await logSignature(approval.origin, request, signature);
        finish(id, signature);
        return { ok: true };
      });
    }
    case "approval:send": {
      const id = String(message.id);
      const approval = approvals.get(id);
      if (!approval || approval.kind !== "send" || !approval.request) return { expired: true };
      return exclusively(id, approval, async () => {
        let request = approval.request as SendRequest;
        if (request.blocked || !request.fee)
          return { error: request.blocked ?? "Can't send this." };
        // The owner's own sends (OWN) have no site to be disconnected from.
        if (approval.origin !== OWN && !accountsFor((await load()).sites, approval.origin).length) {
          finish(id, undefined, rpcError(ERRORS.unauthorized, "The site was disconnected."));
          return { expired: true };
        }
        // Open for over a minute: the fee and the simulation are redone. If
        // it can't go ahead now, or would cost more, the owner sees why.
        if (Date.now() - request.preparedAt > 60_000) {
          const fresh = await prepare(request.tx);
          approval.request = fresh;
          if (fresh.blocked || !fresh.fee || maxFee(fresh) > maxFee(request))
            return {
              refreshed: true,
              error: "Things changed while this was open. Check the new numbers and confirm again.",
            };
          request = fresh;
        }
        const tried = await tryPassword(String(message.password ?? ""));
        if (!tried.ok) return { error: tried.error };
        const outcome = await send(tried.secret, approval.origin, request);
        if (outcome.hash && request.stake) await rememberStake(request.stake, outcome.hash);
        if (outcome.hash) finish(id, outcome.hash);
        else finish(id, undefined, outcome.error);
        return outcome.hash ? { ok: true } : { error: outcome.error?.message };
      });
    }
    case "approval:reject":
      finish(String(message.id), undefined, rpcError(ERRORS.rejected, "The request was declined."));
      return { ok: true };
    default:
      return { error: "Unknown request." };
  }
}

// ------------------------------------------------------------- signing ----

async function sign(secret: string, request: SignRequest): Promise<string> {
  const account = signer(secret);
  if (request.kind === "message")
    return account.signMessage({ message: request.sign as string | { raw: `0x${string}` } });
  const { domain, types, primaryType, message } = request.typed as {
    domain: Record<string, unknown>;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  // The site's own EIP712Domain type is used when it sends one, as the spec says.
  return account.signTypedData({ domain, types, primaryType, message } as Parameters<
    typeof account.signTypedData
  >[0]);
}

// The signature log (core/signature-log.js): a record on this computer of
// every message signed, since a signature leaves no trace on chain.
async function logSignature(origin: string, request: SignRequest, signature: string) {
  const { signatures } = await chrome.storage.local.get("signatures");
  const entry = entryFor(
    request.kind === "typed"
      ? { kind: "typed", typed: request.typed, address: request.address, site: origin, signature }
      : {
          kind: "message",
          message: request.text,
          address: request.address,
          site: origin,
          signature,
        },
  );
  await chrome.storage.local.set({ signatures: append(signatures, entry) });
}

// -------------------------------------------------------- transactions ----

// Everything about sending goes to the network's own node, never the rotation:
// the nonce, the simulation, the broadcast and the receipt have to agree.
async function node(method: string, params: unknown[]) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Robinhood Chain answered HTTP ${response.status}.`);
  const body = await response.json();
  // Marked as the node's own answer, unlike a timeout or a dropped connection
  // (a timeout's DOMException has a numeric code too).
  if (body.error)
    throw Object.assign(new Error(body.error.message), body.error, { fromNode: true });
  return body.result;
}

// A revert's reason, when the contract gave one (Error(string)).
function revertReason(error: { message?: string; data?: unknown }) {
  const data = typeof error.data === "string" ? error.data : "";
  if (data.startsWith("0x08c379a0") && data.length >= 138) {
    try {
      const length = Number(BigInt(`0x${data.slice(74, 138)}`));
      const bytes = data.slice(138, 138 + length * 2).match(/../g) || [];
      return new TextDecoder().decode(Uint8Array.from(bytes, (b) => parseInt(b, 16)));
    } catch {
      // Fall through to the node's message.
    }
  }
  return (
    String(error.message || "it reverted").replace(/^execution reverted:?\s*/i, "") || "it reverted"
  );
}

const loadSent = async () =>
  ((await chrome.storage.local.get("transactions")).transactions as Sent[] | undefined) ?? [];
const saveSent = (list: Sent[]) => chrome.storage.local.set({ transactions: list.slice(0, 50) });

// ERC-721 contracts answer supportsInterface(0x80ac58cd) with true. Tokens
// without ERC-165 revert, which reads as "not an NFT".
async function isNft(contract: string) {
  try {
    const answer = await node("eth_call", [
      { to: contract, data: "0x01ffc9a7" + "80ac58cd".padEnd(64, "0") },
      "latest",
    ]);
    return typeof answer === "string" && answer.length >= 66 && BigInt(answer.slice(0, 66)) === 1n;
  } catch {
    return false;
  }
}

/** Check the chain once and describe the transaction for the approval window. */
async function prepare(tx: Tx): Promise<SendRequest> {
  const paid = (await loadSent()).map((sent) => sent.recipient);
  const nft = tx.data.startsWith("0x095ea7b3") && (await isNft(tx.to));
  const described = describe(tx, { tokens: await tokens(), spenders: SPENDERS, paid, nft });
  const preparedAt = Date.now();
  const call = { from: tx.from, to: tx.to, value: tx.value, data: tx.data };
  let balance: bigint;
  try {
    balance = BigInt(await node("eth_getBalance", [tx.from, "latest"]));
  } catch (error) {
    return {
      tx,
      described,
      preparedAt,
      blocked: `Couldn't reach Robinhood Chain (${String((error as Error).message || error)}).`,
    };
  }
  if (BigInt(tx.value) > balance)
    return {
      tx,
      described,
      preparedAt,
      blocked: `Not enough ETH. This sends ${formatEth(BigInt(tx.value))} ETH and the wallet has ${formatEth(balance)}.`,
    };
  // A transaction that would fail costs its fee and does nothing, so it's
  // simulated first and not offered if it reverts.
  try {
    await node("eth_call", [call, "latest"]);
  } catch (error) {
    return {
      tx,
      described,
      preparedAt,
      blocked: `This transaction would fail: ${revertReason(error as Error)}.`,
    };
  }
  try {
    const [gasHex, block, tipHex] = await Promise.all([
      node("eth_estimateGas", [call]),
      node("eth_getBlockByNumber", ["latest", false]),
      node("eth_maxPriorityFeePerGas", []).catch(() => "0x0"),
    ]);
    // 20% headroom: the chain's L1 share of the cost moves between estimate
    // and inclusion. Unused gas is refunded; the fee cap counts all of it.
    const gas = (BigInt(gasHex) * 12n) / 10n;
    const tip = BigInt(tipHex);
    // As viem estimates fees for the app: the base fee with 20% headroom, plus the tip.
    const maxFeePerGas = (BigInt(block.baseFeePerGas ?? "0x0") * 12n) / 10n + tip;
    const checked = feeCheck({ gas, maxFeePerGas, balance, value: BigInt(tx.value) });
    const fee = {
      gas: gas.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: tip.toString(),
      maxFee: formatEth(checked.maxFee),
    };
    return { tx, described, preparedAt, fee, blocked: checked.error };
  } catch (error) {
    return {
      tx,
      described,
      preparedAt,
      blocked: `Couldn't work out the network fee (${String((error as Error).message || error)}). Try again in a moment.`,
    };
  }
}

const maxFee = (request: SendRequest) =>
  request.fee ? BigInt(request.fee.gas) * BigInt(request.fee.maxFeePerGas) : 0n;

/** Sign, record, broadcast once. Never retried: a node may have accepted it. */
async function send(
  secret: string,
  origin: string,
  request: SendRequest,
): Promise<{ hash?: string; error?: RpcErr }> {
  const { tx, fee, described } = request;
  if (!fee) return { error: rpcError(ERRORS.internal, "No fee was prepared.") };
  const nonce = Number(BigInt(await node("eth_getTransactionCount", [tx.from, "pending"])));
  const serialized = await signer(secret).signTransaction({
    type: "eip1559",
    chainId: CHAIN_ID,
    nonce,
    to: tx.to as `0x${string}`,
    value: BigInt(tx.value),
    data: tx.data as `0x${string}`,
    gas: BigInt(fee.gas),
    maxFeePerGas: BigInt(fee.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(fee.maxPriorityFeePerGas),
  });
  const hash = keccak256(serialized);
  const recipient = described.rows.find(([label]) => label === "To")?.[1] ?? tx.to;
  // The hash is written down before the broadcast, so an uncertain send can
  // always be checked rather than guessed at.
  const entry: Sent = {
    hash,
    at: Date.now(),
    site: origin,
    title: described.title,
    recipient,
    from: tx.from,
    nonce,
    status: "broadcasting",
  };
  await saveSent([entry, ...(await loadSent())]);
  const mark = async (status: Sent["status"]) =>
    saveSent((await loadSent()).map((sent) => (sent.hash === hash ? { ...sent, status } : sent)));
  try {
    await node("eth_sendRawTransaction", [serialized]);
  } catch (error) {
    const e = error as { fromNode?: boolean; message?: string };
    // The node said no outright: nothing was sent.
    if (e.fromNode) {
      await mark("failed");
      return { error: rpcError(ERRORS.internal, `Robinhood Chain refused it: ${e.message}`) };
    }
    // No clear answer: it may or may not have gone. Say so; don't retry.
    await mark("unknown");
    return {
      error: {
        code: ERRORS.internal,
        message:
          "Tera couldn't confirm the network received this. Check Recent transactions in Tera before trying again.",
        data: { hash },
      },
    };
  }
  await mark("pending");
  return { hash };
}

const OPEN: Sent["status"][] = ["broadcasting", "pending", "unknown"];

/** Recent transactions, with any still open checked against the chain. */
async function refreshSent() {
  const list = await loadSent();
  const open = list.filter((sent) => OPEN.includes(sent.status));
  if (!open.length) return list;
  const senders = [...new Set(open.flatMap((sent) => (sent.from ? [sent.from] : [])))];
  const [receipts, counts] = await Promise.all([
    Promise.all(
      open.map((sent) => node("eth_getTransactionReceipt", [sent.hash]).catch(() => null)),
    ),
    Promise.all(
      senders.map((address) =>
        node("eth_getTransactionCount", [address, "latest"])
          .then((count) => Number(BigInt(count)))
          .catch(() => null),
      ),
    ),
  ]);
  const mined = new Map(senders.map((address, i) => [address, counts[i]]));
  const changed = new Map<string, Sent["status"]>();
  open.forEach((sent, i) => {
    const receipt = receipts[i];
    const count = sent.from ? mined.get(sent.from) : null;
    const status: Sent["status"] = receipt
      ? receipt.status === "0x1"
        ? "confirmed"
        : "failed"
      : sent.nonce !== undefined && typeof count === "number" && count > sent.nonce
        ? "dropped" // another transaction took its nonce
        : sent.status === "broadcasting" && Date.now() - sent.at > 120_000
          ? "unknown" // the worker stopped mid-broadcast
          : sent.status;
    if (status !== sent.status) changed.set(sent.hash, status);
  });
  if (!changed.size) return list;
  // Read again and change only these entries: a send may have updated the
  // list while the chain was being asked.
  const next = (await loadSent()).map((sent) =>
    changed.has(sent.hash) ? { ...sent, status: changed.get(sent.hash)! } : sent,
  );
  await saveSent(next);
  return next;
}

// --------------------------------------------------------------- wallet ----

// Tera's asset registry and prices, from the same API the app uses. Neither
// request says which wallet is asking; balances come from the chain.
async function api(path: string, body?: unknown) {
  if (!API.startsWith("https://")) throw new Error("HTTPS is required.");
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok || answer.success === false)
    throw new Error(
      typeof answer.error === "string" ? answer.error : `Tera answered HTTP ${response.status}.`,
    );
  return answer;
}

const HOUR = 3_600_000;

/** The assets the wallet lists: its own, then the registry's (refreshed hourly, kept if Tera is down). */
async function registry(): Promise<Asset[]> {
  const { registry: cached } = (await chrome.storage.local.get("registry")) as {
    registry?: { at: number; entries: unknown[] };
  };
  if (cached && Date.now() - cached.at < HOUR) return cleanRegistry(cached.entries, PINNED);
  try {
    const { assets } = await api("/api/assets");
    await chrome.storage.local.set({ registry: { at: Date.now(), entries: assets } });
    return cleanRegistry(assets, PINNED);
  } catch {
    return cleanRegistry(cached?.entries ?? [], PINNED);
  }
}

let priceCache: { at: number; prices: Record<string, number> } | null = null;
async function prices() {
  if (priceCache && Date.now() - priceCache.at < 60_000) return priceCache;
  try {
    const body = await api("/api/assets/prices");
    priceCache = { at: Date.now(), prices: body.prices ?? {} };
  } catch {
    // No prices: balances still show; values show as unknown.
  }
  return priceCache ?? { at: 0, prices: {} };
}

/** One asset's balance in base units, or null when it couldn't be read. */
function balanceOf(asset: Asset, owner: string): Promise<string | null> {
  return (
    asset.address === NATIVE
      ? read("eth_getBalance", [owner, "latest"])
      : read("eth_call", [
          {
            to: asset.address,
            data: "0x70a08231" + owner.slice(2).toLowerCase().padStart(64, "0"),
          },
          "latest",
        ])
  )
    .then((hex: string) => (hex && hex !== "0x" ? BigInt(hex.slice(0, 66)).toString() : "0"))
    .catch(() => null);
}

/** Balances for every listed asset, prices, and the fee rate for ETH's Max. */
async function balances() {
  const { vault } = await load();
  if (!vault) return { error: "There's no wallet in this browser yet." };
  const owner = vault.address;
  const assets = await registry();
  const [amounts, priced, block, tip] = await Promise.all([
    Promise.all(assets.map((asset) => balanceOf(asset, owner))),
    prices(),
    read("eth_getBlockByNumber", ["latest", false]).catch(() => null),
    read("eth_maxPriorityFeePerGas", []).catch(() => "0x0"),
  ]);
  const maxFeePerGas = block?.baseFeePerGas
    ? ((BigInt(block.baseFeePerGas) * 12n) / 10n + BigInt(tip)).toString()
    : null;
  return {
    address: owner,
    assets,
    balances: Object.fromEntries(assets.map((asset, i) => [asset.address, amounts[i]])),
    prices: priced.prices,
    pricesAt: priced.at,
    maxFeePerGas,
  };
}

/** A send the owner started in the popup: checked, prepared, and opened in the review window. */
async function walletSend(message: PageMessage) {
  const { vault } = await load();
  if (!vault) return { error: "There's no wallet in this browser yet." };
  const wanted = String(message.asset ?? "").toLowerCase();
  const asset = (await registry()).find((a) => a.address === wanted);
  if (!asset) return { error: "Pick an asset to send." };
  const recipient = checkRecipient(message.to, { owner: vault.address, asset });
  if (recipient.error) return { error: recipient.error };
  const amount = toUnits(message.amount, asset.decimals);
  if (amount.error) return { error: amount.error };
  const short = checkAmount({
    units: amount.units,
    balance: await balanceOf(asset, vault.address),
    symbol: asset.symbol,
    decimals: asset.decimals,
  });
  if (short) return { error: short };
  const tx = buildTransfer({
    owner: vault.address,
    asset,
    to: recipient.address,
    units: amount.units,
  }) as Tx;
  oneAtATime(OWN);
  preparing.add(OWN);
  let prepared: SendRequest;
  try {
    prepared = await prepare(tx);
  } finally {
    preparing.delete(OWN);
  }
  const paid = (await loadSent()).map((sent) => sent.recipient.toLowerCase());
  if (recipient.self)
    prepared.described.warnings.push(
      "This sends to your own address. Nothing leaves the wallet but the fee.",
    );
  else if (!paid.includes(String(recipient.address)))
    prepared.described.warnings.push(
      "You haven't sent to this address from this browser before. Check it against where you got it, all the way through.",
    );
  // The review window decides; the popup has usually closed by then.
  ask("send", OWN, prepared).catch(() => {});
  return { ok: true };
}

// ----------------------------------------------------------------- swap ----

const units = (text: unknown, decimals: number) => toUnits(text, decimals);

/** Ask Tera for a swap, check it on this device, and describe it. */
async function prepareSwap(owner: string, params: SwapRequest["params"]): Promise<SwapRequest> {
  const assets = await registry();
  const asset = tradable(assets).find((a: Asset) => a.address === params.asset);
  if (!asset) throw new Error("Pick an asset to swap.");
  const pair = swapPair(asset, params.side, assets);
  if (!pair) throw new Error("This swap isn't offered.");
  const amount = units(params.amount, pair.pay.decimals);
  if (amount.error) throw new Error(amount.error);
  const intent = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: asset.address,
    actionType: params.side,
    amount: amount.units!.toString(),
    slippageBps: params.slippageBps,
  };
  // Tera's signed policy, checked on this device (android/src/policy.ts).
  const checked = await policyFor(intent);
  const result = await api("/api/intent/prepare", checked);
  const proposal = { ...result, intent: checked, createdAt: Date.now() };
  // Every step rebuilt and compared here; a proposal that differs is refused.
  const steps = verifyProposal(proposal, owner);
  const quote = proposal.preparedTransaction.quote;
  const price = (await prices()).prices[pair.pay.priceAs ?? pair.pay.symbol];
  const payUsd =
    typeof price === "number" ? (Number(amount.units) / 10 ** pair.pay.decimals) * price : null;
  const review = swapReview({
    units: amount.units!,
    quote,
    pay: pair.pay,
    receive: pair.receive,
    slippageBps: params.slippageBps,
    payUsd,
  });
  const balance = await balanceOf(pair.pay, owner);
  const short = checkAmount({
    units: amount.units,
    balance,
    symbol: pair.pay.symbol,
    decimals: pair.pay.decimals,
  });
  // The first step is simulated now; later ones need the step before them on
  // chain first, so each is simulated just before it's sent.
  let blocked = review.blocked ?? short ?? undefined;
  if (!blocked) {
    const first = steps[0];
    try {
      await node("eth_call", [
        {
          from: owner,
          to: first.to,
          data: first.data,
          value: `0x${BigInt(first.value).toString(16)}`,
        },
        "latest",
      ]);
    } catch (error) {
      blocked = `This swap would fail: ${revertReason(error as Error)}.`;
    }
  }
  return {
    params,
    proposal,
    steps: steps.map((step) => ({ to: step.to, data: step.data, value: String(step.value) })),
    labels: steps.map((step) =>
      stepLabel(step, { pay: pair.pay, spenders: { ...SPENDERS, [PERMIT2]: "Permit2" } }),
    ),
    review,
    checks: proposalVerdicts(proposal, owner).summary.line,
    preparedAt: Date.now(),
    ...(blocked ? { blocked } : {}),
  };
}

async function walletSwap(message: PageMessage) {
  const { vault } = await load();
  if (!vault) return { error: "There's no wallet in this browser yet." };
  const side = message.side === "SELL" ? "SELL" : message.side === "BUY" ? "BUY" : null;
  const slippageBps = Number(message.slippageBps);
  if (!side) return { error: "Choose Buy or Sell." };
  if (!isSlippageBps(slippageBps)) return { error: "Pick a slippage limit from 0.1% to 5%." };
  oneAtATime(OWN);
  preparing.add(OWN);
  let request: SwapRequest;
  try {
    request = await prepareSwap(vault.address, {
      asset: String(message.asset ?? "").toLowerCase(),
      side,
      amount: String(message.amount ?? "").trim(),
      slippageBps,
    });
  } catch (error) {
    return { error: String((error as Error).message || error) };
  } finally {
    preparing.delete(OWN);
  }
  ask("swap", OWN, request).catch(() => {});
  return { ok: true };
}

const QUOTE_LIFE = 90_000;

/** Wait for a step to be mined, keeping the worker awake meanwhile. */
async function receiptOf(hash: string, timeout = 90_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const receipt = await node("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (receipt) return receipt;
    // An extension call resets Chrome's idle timer for this worker.
    await chrome.runtime.getPlatformInfo();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

/** The approved swap: each step checked, simulated, signed and sent in turn. */
async function runSwap(id: string, approval: Approval, message: PageMessage) {
  let request = approval.request as SwapRequest;
  if (request.blocked) return { error: request.blocked };
  if (request.review.consent && message.consent !== true)
    return { error: "Tick that you accept the price impact first." };
  const { vault } = await load();
  if (!vault) return { error: "There's no wallet in this browser yet." };
  // A quote over 90 seconds old is fetched again and shown before anything is signed.
  if (Date.now() - request.preparedAt > QUOTE_LIFE) {
    try {
      approval.request = await prepareSwap(vault.address, request.params);
    } catch (error) {
      return { error: String((error as Error).message || error) };
    }
    return {
      refreshed: true,
      error: "The quote expired, so here's a fresh one. Check the numbers and confirm again.",
    };
  }
  const tried = await tryPassword(String(message.password ?? ""));
  if (!tried.ok) return { error: tried.error };
  // Checked again at the moment of signing: the quote's age and every byte.
  try {
    verifyProposal(request.proposal, vault.address);
  } catch (error) {
    return { error: String((error as Error).message || error) };
  }
  let hash = "";
  for (let index = 0; index < request.steps.length; index++) {
    const step = request.steps[index];
    const last = index === request.steps.length - 1;
    request = {
      ...request,
      progress: `Step ${index + 1} of ${request.steps.length}: ${request.labels[index]}…`,
    };
    approval.request = request;
    const prepared = await prepare({
      from: vault.address,
      to: step.to.toLowerCase(),
      value: `0x${BigInt(step.value).toString(16)}`,
      data: step.data.toLowerCase(),
    });
    if (prepared.blocked) {
      approval.request = { ...request, progress: undefined };
      return {
        error: index
          ? `Step ${index + 1} stopped before sending: ${prepared.blocked} The approval before it went through; nothing else was sent.`
          : prepared.blocked,
      };
    }
    prepared.described = {
      ...prepared.described,
      title: last ? request.review.title : `Approval for swap: ${request.labels[index]}`,
    };
    const outcome = await send(tried.secret, OWN, prepared);
    if (!outcome.hash) {
      approval.request = { ...request, progress: undefined };
      finish(id, undefined, outcome.error);
      return { error: outcome.error?.message };
    }
    hash = outcome.hash;
    if (!last) {
      const receipt = await receiptOf(hash);
      if (!receipt || receipt.status !== "0x1") {
        const error = receipt
          ? "The approval failed on chain, so the swap wasn't sent."
          : "The approval hasn't confirmed yet, so the swap wasn't sent. Check Activity, then swap again.";
        finish(id, undefined, rpcError(ERRORS.internal, error));
        return { error };
      }
    }
  }
  finish(id, hash);
  return { ok: true };
}

// -------------------------------------------------------------- staking ----

/** This wallet's staking: positions, fixed locks, payouts, the epoch, and deposits waiting to be credited. */
async function staking() {
  const { vault } = await load();
  if (!vault) return { error: "There's no wallet in this browser yet." };
  const owner = vault.address;
  void creditAll();
  try {
    const [positions, locks, payouts, epochs, config] = await Promise.all([
      api(`/api/staking/position/${owner}`),
      api(`/api/staking/locks/${owner}`).catch(() => ({ locks: [] })),
      api(`/api/staking/payouts/${owner}`).catch(() => ({ payouts: [] })),
      api("/api/staking/epochs").catch(() => ({ epochs: [] })),
      api("/api/staking/config").catch(() => null),
    ]);
    const epoch = activeEpoch(epochs.epochs);
    const tera = (await registry()).find((a) => a.symbol === "TERA");
    return {
      positions: positions.positions ?? [],
      locks: locks.locks ?? [],
      payouts: (payouts.payouts ?? []).slice(0, 10),
      epoch,
      flexibleApr: flexibleApr(epoch),
      configured: Boolean(config?.poolAddress && config?.tokenAddress),
      balance: tera ? await balanceOf(tera, owner) : null,
      pending: pendingFor((await chrome.storage.local.get("stakingPending")).stakingPending, owner),
    };
  } catch (error) {
    return { error: String((error as Error).message || error) };
  }
}

async function rememberStake(stake: NonNullable<SendRequest["stake"]>, hash: string) {
  const { vault } = await load();
  const { stakingPending } = await chrome.storage.local.get("stakingPending");
  await chrome.storage.local.set({
    stakingPending: addPending(stakingPending, { ...stake, txHash: hash, owner: vault?.address }),
  });
  void creditAll(20);
}

let crediting = false;
/** Ask Tera's service to credit every deposit still waiting, a few times over. */
async function creditAll(rounds = 1) {
  if (crediting) return;
  crediting = true;
  try {
    for (let round = 0; round < rounds; round++) {
      const { vault } = await load();
      const { stakingPending } = await chrome.storage.local.get("stakingPending");
      const waiting = pendingFor(stakingPending, vault?.address);
      if (!waiting.length) return;
      for (const entry of waiting) {
        const request = creditRequest(entry);
        const outcome = creditOutcome(await api(request.path, request.body).catch(() => null));
        if (outcome === "credited") {
          const now = (await chrome.storage.local.get("stakingPending")).stakingPending;
          await chrome.storage.local.set({ stakingPending: resolvePending(now, entry.txHash) });
        }
      }
      if (round < rounds - 1) {
        await chrome.runtime.getPlatformInfo();
        await new Promise((resolve) => setTimeout(resolve, 12_000));
      }
    }
  } finally {
    crediting = false;
  }
}

async function walletStake(message: PageMessage) {
  const { vault } = await load();
  if (!vault) return { error: "There's no wallet in this browser yet." };
  const owner = vault.address;
  const term = String(message.term ?? "flexible");
  const fixed = term !== "flexible";
  if (fixed && !["30", "45", "90"].includes(term)) return { error: "Pick a lock term." };
  const amount = units(message.amount, 18);
  if (amount.error) return { error: amount.error };
  oneAtATime(OWN);
  preparing.add(OWN);
  try {
    const [config, epochs] = await Promise.all([
      api("/api/staking/config"),
      api("/api/staking/epochs").catch(() => ({ epochs: [] })),
    ]);
    if (!config?.poolAddress || !config?.tokenAddress)
      return { error: "Staking is unavailable right now." };
    const tera = (await registry()).find(
      (a) => a.address === String(config.tokenAddress).toLowerCase(),
    );
    if (!tera) return { error: "TERA isn't in Tera's asset list right now." };
    const short = checkAmount({
      units: amount.units,
      balance: await balanceOf(tera, owner),
      symbol: "TERA",
      decimals: 18,
    });
    if (short) return { error: short };
    const epoch = activeEpoch(epochs.epochs);
    if (!fixed && !epoch) return { error: "There's no staking epoch to join right now." };
    const preparedDeposit = await api("/api/staking/prepare-deposit", {
      amount: amount.units!.toString(),
      ...(fixed ? { termDays: Number(term) } : {}),
    });
    const tx = preparedDeposit.preparedTransaction;
    // The transfer is checked here: TERA, to the pool, for exactly this amount.
    const issue = depositIssue(tx, {
      token: config.tokenAddress,
      pool: config.poolAddress,
      amount: amount.units,
      chainId: CHAIN_ID,
    });
    if (issue) return { error: issue };
    if (
      String(preparedDeposit.poolAddress).toLowerCase() !== String(config.poolAddress).toLowerCase()
    )
      return { error: "The staking pool changed. Try again." };
    const prepared = await prepare({
      from: owner,
      to: String(tx.to).toLowerCase(),
      value: "0x0",
      data: String(tx.data).toLowerCase(),
    });
    const shown = `${formatUnits(amount.units, 18)} TERA`;
    const reward = fixed ? fixedReward(amount.units, Number(term)) : 0n;
    const apr = fixed ? null : flexibleApr(epoch, amount.units);
    prepared.described = {
      ...prepared.described,
      kind: "stake",
      danger: "low",
      title: `Stake ${shown}`,
      rows: [
        ["Amount", shown],
        ["Type", fixed ? `Fixed ${term}-day lock` : "Flexible: unstake any time"],
        fixed
          ? ["Guaranteed reward", `${formatUnits(reward, 18)} TERA`]
          : ["Current rate (variable)", apr === null ? "—" : `≈ ${apr.toFixed(2)}% a year`],
        ...(fixed
          ? [
              [
                "Unlocks",
                new Date(Date.now() + Number(term) * 86_400_000).toLocaleDateString(),
              ] as [string, string],
            ]
          : []),
        ["Staking pool", String(config.poolAddress)],
      ],
      warnings: fixed
        ? [
            `Locked TERA can't be withdrawn for ${term} days. Rewards are paid with it when the lock ends.`,
          ]
        : [],
    };
    prepared.stake = fixed
      ? { kind: "fixed", termDays: Number(term), amount: amount.units!.toString() }
      : { kind: "flexible", epochId: epoch.id, amount: amount.units!.toString() };
    ask("send", OWN, prepared).catch(() => {});
    return { ok: true };
  } catch (error) {
    return { error: String((error as Error).message || error) };
  } finally {
    preparing.delete(OWN);
  }
}

async function walletStakeSign(message: PageMessage) {
  const { vault } = await load();
  if (!vault) return { error: "There's no wallet in this browser yet." };
  const owner = vault.address;
  const kind = message.kind;
  if (kind !== "claim" && kind !== "unstake" && kind !== "unlock")
    return { error: "Unknown staking request." };
  oneAtATime(OWN);
  try {
    const state = await staking();
    if ("error" in state) return { error: state.error };
    const key = crypto.randomUUID();
    let request: StakeSignRequest;
    if (kind === "unlock") {
      const lock = state.locks.find((l: { id: string }) => l.id === String(message.lockId));
      if (!lock || !lock.isMatured) return { error: "That lock hasn't ended yet." };
      const total = (BigInt(lock.principal_amount) + BigInt(lock.reward_amount)).toString();
      const body = { walletAddress: owner, lockId: lock.id, idempotencyKey: key };
      const auth = await api("/api/staking/locks/unlock-authorization", body);
      const checked = stakingSignature(
        "unlock",
        { wallet: owner, lockId: lock.id, amount: total, key },
        auth.message,
      );
      if (checked.error) return { error: checked.error };
      request = {
        title: `Unlock ${formatUnits(total, 18)} TERA`,
        rows: [
          ["Principal", `${formatUnits(lock.principal_amount, 18)} TERA`],
          ["Reward", `${formatUnits(lock.reward_amount, 18)} TERA`],
          ["Paid to", owner],
        ],
        message: checked.message!,
        submit: { path: "/api/staking/locks/unlock", body },
      };
    } else {
      const position = state.positions.find(
        (p: { epoch_id: string }) => p.epoch_id === String(message.epochId),
      );
      if (!position) return { error: "That staking position wasn't found." };
      const staked = BigInt(position.active_stake || "0");
      const claimable = BigInt(position.claimable_rewards || "0");
      if (kind === "claim" && claimable <= 0n)
        return { error: "There are no rewards to claim yet." };
      if (kind === "unstake" && (staked <= 0n || position.is_locked))
        return {
          error: position.is_locked ? "This stake is still locked." : "Nothing is staked here.",
        };
      const amount = kind === "unstake" ? staked.toString() : "0";
      const body = {
        kind,
        walletAddress: owner,
        epochId: position.epoch_id,
        amount,
        idempotencyKey: key,
      };
      const auth = await api("/api/staking/payout-authorization", body);
      const checked = stakingSignature(
        kind,
        { wallet: owner, epochId: position.epoch_id, amount, key },
        auth.message,
      );
      if (checked.error) return { error: checked.error };
      request = {
        title:
          kind === "claim"
            ? `Claim ${formatUnits(claimable, 18)} TERA in rewards`
            : `Unstake ${formatUnits(staked, 18)} TERA`,
        rows:
          kind === "claim"
            ? [
                ["Rewards", `${formatUnits(claimable, 18)} TERA`],
                ["Paid to", owner],
              ]
            : [
                ["Staked", `${formatUnits(staked, 18)} TERA`],
                ["Unclaimed rewards", `${formatUnits(claimable, 18)} TERA`],
                ["Paid to", owner],
              ],
        message: checked.message!,
        submit: { path: "/api/staking/payouts", body },
      };
    }
    ask("stake-sign", OWN, request).catch(() => {});
    return { ok: true };
  } catch (error) {
    return { error: String((error as Error).message || error) };
  }
}

// ---------------------------------------------------------------- reads ----

// Reads rotate across independent nodes, as in the app (core/rpc-rotation.js),
// so no single operator sees every site's every query.
const NODES = nodeList(RPC, PUBLIC_RPCS);
const rotation = createRotation(NODES.length);
let rpcId = 0;

async function read(method: string, params: unknown[]) {
  let lastFault: unknown;
  for (const index of rotation.next(method)) {
    try {
      const response = await fetch(NODES[index], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
      const body = await response.json();
      if (body.error) {
        if (isNodeFault(body.error)) throw body.error;
        throw {
          code: body.error.code,
          message: body.error.message,
          data: body.error.data,
        } as RpcErr;
      }
      return body.result;
    } catch (error) {
      if (!isNodeFault(error)) throw error;
      lastFault = error;
    }
  }
  throw rpcError(
    ERRORS.disconnected,
    `Couldn't reach Robinhood Chain (${String((lastFault as Error)?.message || lastFault)}).`,
  );
}
