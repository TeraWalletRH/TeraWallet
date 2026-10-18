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
import {
  describe,
  feeCheck,
  formatEth,
  readTransaction,
} from "../../public/tera/core/dapp-send.js";
import { keccak256 } from "viem";
import { KNOWN_SPENDERS } from "../../public/tera/core/approvals.js";
import { append, entryFor } from "../../public/tera/core/signature-log.js";
import { createRotation, isNodeFault, nodeList } from "../../public/tera/core/rpc-rotation.js";
import { PUBLIC_RPCS, RPC, USDG } from "../../android/src/config";
import { createVault, openSecret, signer, type Vault } from "./vault";

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
  // Set when the transaction can't go ahead: it would fail, or can't be paid for.
  blocked?: string;
};
type Sent = {
  hash: string;
  at: number;
  site: string;
  title: string;
  recipient: string;
  status: "broadcasting" | "pending" | "confirmed" | "failed" | "unknown";
};

// What typed-data explanations name: the tokens and contracts Tera knows.
const TOKENS = { [USDG.toLowerCase()]: { symbol: "USDG", decimals: 6 } };
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
  const { sites } = await load();
  switch (classify(method)) {
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
        tokens: TOKENS,
        spenders: SPENDERS,
      });
      if ("error" in request) throw request.error;
      return askToSign(origin, request as SignRequest);
    }
    case "send": {
      const read = readTransaction(params, { accounts: accountsFor(sites, origin) });
      if (read.error) throw read.error;
      oneAtATime(origin);
      return ask("send", origin, await prepare(read.tx as Tx));
    }
    default:
      throw rpcError(ERRORS.unsupported, `Tera Wallet doesn't support ${method}.`);
  }
}

// ------------------------------------------------------------ approvals ----

type Approval = {
  kind: "connect" | "sign" | "send";
  origin: string;
  request?: SignRequest | SendRequest;
  resolve: (value: unknown) => void;
  reject: (error: RpcErr) => void;
  promise: Promise<unknown>;
  windowId?: number;
};
const approvals = new Map<string, Approval>();

function ask(kind: Approval["kind"], origin: string, request?: SignRequest | SendRequest) {
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

function askToConnect(origin: string) {
  // A site asking twice while the first window is open gets the same window.
  for (const approval of approvals.values())
    if (approval.kind === "connect" && approval.origin === origin)
      return approval.promise as Promise<string[]>;
  return ask("connect", origin) as Promise<string[]>;
}

// One signature or transaction at a time per site, so a page can't bury the
// owner in windows.
function oneAtATime(origin: string) {
  for (const approval of approvals.values())
    if (approval.kind !== "connect" && approval.origin === origin)
      throw rpcError(ERRORS.pending, "A request from this site is already open in Tera.");
}

function askToSign(origin: string, request: SignRequest) {
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
  if (error) approval.reject(error);
  else approval.resolve(result);
  if (approval.windowId !== undefined) chrome.windows.remove(approval.windowId).catch(() => {});
}

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, approval] of approvals)
    if (approval.windowId === windowId) {
      approval.windowId = undefined;
      finish(id, undefined, rpcError(ERRORS.rejected, "The request was declined."));
    }
});

// ----------------------------------------------------------- passwords ----

async function tryPassword(
  password: string,
): Promise<{ ok: true; vault: Vault; secret: string } | { ok: false; error: string }> {
  const { vault, failures, failedAt } = await load();
  if (!vault) return { ok: false, error: "There's no wallet in this browser yet." };
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
  password?: unknown;
  origin?: unknown;
};

async function page(message: PageMessage) {
  switch (message?.type) {
    case "ping":
      return { ok: true };
    case "state": {
      const { vault, sites } = await load();
      const { signatures } = await chrome.storage.local.get("signatures");
      return {
        address: vault?.address ?? null,
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
    case "wallet:remove": {
      const tried = await tryPassword(String(message.password ?? ""));
      if (!tried.ok) return { error: tried.error };
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
    case "approval:get": {
      const approval = approvals.get(String(message.id));
      if (!approval) return { expired: true };
      const { vault } = await load();
      return {
        kind: approval.kind,
        origin: approval.origin,
        address: vault?.address ?? null,
        request: approval.request,
      };
    }
    case "approval:connect": {
      const approval = approvals.get(String(message.id));
      if (!approval) return { expired: true };
      const tried = await tryPassword(String(message.password ?? ""));
      if (!tried.ok) return { error: tried.error };
      const accounts = [tried.vault.address];
      await setSites(grant((await load()).sites, approval.origin, accounts));
      // Other tabs of the same site hear about it; this one gets the answer.
      broadcast(approval.origin, "accountsChanged", accounts);
      finish(String(message.id), accounts);
      return { ok: true };
    }
    case "approval:sign": {
      const approval = approvals.get(String(message.id));
      if (!approval?.request) return { expired: true };
      // The site may have been disconnected while the window was open.
      if (!accountsFor((await load()).sites, approval.origin).length) {
        finish(
          String(message.id),
          undefined,
          rpcError(ERRORS.unauthorized, "The site was disconnected."),
        );
        return { expired: true };
      }
      const tried = await tryPassword(String(message.password ?? ""));
      if (!tried.ok) return { error: tried.error };
      const signature = await sign(tried.secret, approval.request as SignRequest);
      await logSignature(approval.origin, approval.request as SignRequest, signature);
      finish(String(message.id), signature);
      return { ok: true };
    }
    case "approval:send": {
      const id = String(message.id);
      const approval = approvals.get(id);
      const request = approval?.request as SendRequest | undefined;
      if (!approval || approval.kind !== "send" || !request) return { expired: true };
      if (request.blocked || !request.fee) return { error: request.blocked ?? "Can't send this." };
      if (!accountsFor((await load()).sites, approval.origin).length) {
        finish(id, undefined, rpcError(ERRORS.unauthorized, "The site was disconnected."));
        return { expired: true };
      }
      const tried = await tryPassword(String(message.password ?? ""));
      if (!tried.ok) return { error: tried.error };
      const outcome = await send(tried.secret, approval.origin, request);
      if (outcome.hash) finish(id, outcome.hash);
      else finish(id, undefined, outcome.error);
      return outcome.hash ? { ok: true } : { error: outcome.error?.message };
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
  if (body.error) throw Object.assign(new Error(body.error.message), body.error);
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

/** Check the chain once and describe the transaction for the approval window. */
async function prepare(tx: Tx): Promise<SendRequest> {
  const paid = (await loadSent()).map((sent) => sent.recipient);
  const described = describe(tx, { tokens: TOKENS, spenders: SPENDERS, paid });
  const call = { from: tx.from, to: tx.to, value: tx.value, data: tx.data };
  let balance: bigint;
  try {
    balance = BigInt(await node("eth_getBalance", [tx.from, "latest"]));
  } catch (error) {
    return {
      tx,
      described,
      blocked: `Couldn't reach Robinhood Chain (${String((error as Error).message || error)}).`,
    };
  }
  if (BigInt(tx.value) > balance)
    return {
      tx,
      described,
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
      blocked: `This transaction would fail: ${revertReason(error as Error)}.`,
    };
  }
  try {
    const [gasHex, block, tipHex] = await Promise.all([
      node("eth_estimateGas", [call]),
      node("eth_getBlockByNumber", ["latest", false]),
      node("eth_maxPriorityFeePerGas", []).catch(() => "0x0"),
    ]);
    const gas = BigInt(gasHex);
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
    return { tx, described, fee, blocked: checked.error };
  } catch (error) {
    return {
      tx,
      described,
      blocked: `Couldn't work out the network fee (${String((error as Error).message || error)}). Try again in a moment.`,
    };
  }
}

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
    status: "broadcasting",
  };
  await saveSent([entry, ...(await loadSent())]);
  const mark = async (status: Sent["status"]) =>
    saveSent((await loadSent()).map((sent) => (sent.hash === hash ? { ...sent, status } : sent)));
  try {
    await node("eth_sendRawTransaction", [serialized]);
  } catch (error) {
    const e = error as { code?: number; message?: string };
    // The node said no outright: nothing was sent.
    if (typeof e.code === "number") {
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

/** Recent transactions, with any that were pending checked against the chain. */
async function refreshSent() {
  const list = await loadSent();
  const open = list.filter((sent) => sent.status === "pending" || sent.status === "unknown");
  if (!open.length) return list;
  const receipts = await Promise.all(
    open.map((sent) => node("eth_getTransactionReceipt", [sent.hash]).catch(() => null)),
  );
  const status = new Map(
    open.map((sent, i) => [
      sent.hash,
      receipts[i] ? (receipts[i].status === "0x1" ? "confirmed" : "failed") : sent.status,
    ]),
  );
  const next = list.map((sent) => ({
    ...sent,
    status: (status.get(sent.hash) ?? sent.status) as Sent["status"],
  }));
  await saveSent(next);
  return next;
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
