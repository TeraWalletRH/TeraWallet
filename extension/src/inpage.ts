// The provider a site talks to: window.ethereum, and the EIP-6963
// announcement that lets a site list Tera beside any other wallet.
//
// This file runs inside the site's own page, alongside the site's code, so
// it holds nothing worth stealing: no key, no address until the owner
// connects, no decisions. Every request is posted to content.ts, which hands
// it to the background worker, which decides. A site that tampers with this
// object only lies to itself.

declare const __TERA_ICON__: string;

type ProviderRequest = { method: string; params?: unknown[] | Record<string, unknown> };
type Listener = (...args: unknown[]) => void;

const TO_CONTENT = "tera:to-content";
const TO_PAGE = "tera:to-page";
const CHAIN_HEX = "0x1237";

class ProviderError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
const listeners = new Map<string, Set<Listener>>();

function emit(event: string, ...args: unknown[]) {
  for (const fn of [...(listeners.get(event) || [])]) {
    try {
      fn(...args);
    } catch (error) {
      console.error(error);
    }
  }
}

const provider = {
  isTera: true,
  isMetaMask: false,
  chainId: CHAIN_HEX as string | null,
  networkVersion: "4663",
  selectedAddress: null as string | null,

  request(args: ProviderRequest): Promise<unknown> {
    if (!args || typeof args !== "object" || typeof args.method !== "string")
      return Promise.reject(new ProviderError(-32600, "Expected { method, params }."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // Params are copied to plain data here, so the background never sees
      // a getter or a proxy the page built.
      let params: unknown;
      try {
        params = args.params === undefined ? undefined : JSON.parse(JSON.stringify(args.params));
      } catch {
        pending.delete(id);
        reject(new ProviderError(-32602, "Params must be plain JSON."));
        return;
      }
      window.postMessage(
        { target: TO_CONTENT, id, request: { method: args.method, params } },
        location.origin,
      );
    });
  },

  // The pre-EIP-1193 way of asking to connect, still used by older sites.
  enable() {
    return provider.request({ method: "eth_requestAccounts" });
  },

  isConnected() {
    return true;
  },

  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
    return provider;
  },

  once(event: string, fn: Listener) {
    const wrapped: Listener = (...args) => {
      provider.removeListener(event, wrapped);
      fn(...args);
    };
    return provider.on(event, wrapped);
  },

  removeListener(event: string, fn: Listener) {
    listeners.get(event)?.delete(fn);
    return provider;
  },

  off(event: string, fn: Listener) {
    return provider.removeListener(event, fn);
  },

  removeAllListeners(event?: string) {
    if (event) listeners.delete(event);
    else listeners.clear();
    return provider;
  },
};

function noteAccounts(accounts: unknown) {
  if (Array.isArray(accounts)) provider.selectedAddress = (accounts[0] as string) ?? null;
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.target !== TO_PAGE) return;
  if (data.event) {
    if (data.event === "accountsChanged") noteAccounts(data.data);
    emit(data.event, data.data);
    return;
  }
  const waiting = pending.get(data.id);
  if (!waiting) return;
  pending.delete(data.id);
  if (data.error)
    waiting.reject(new ProviderError(data.error.code, data.error.message, data.error.data));
  else {
    if (data.method === "eth_requestAccounts" || data.method === "eth_accounts")
      noteAccounts(data.result);
    waiting.resolve(data.result);
  }
});

Object.freeze(provider.request);

const info = Object.freeze({
  uuid: crypto.randomUUID(),
  name: "Tera Wallet",
  icon: __TERA_ICON__,
  rdns: "app.terawallet",
});
const announce = () =>
  window.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }),
  );
window.addEventListener("eip6963:requestProvider", announce);
announce();

// window.ethereum only if no other wallet has it. Taking it from another
// wallet would break that wallet on every site; sites that list wallets find
// Tera through the announcement above either way.
if (!("ethereum" in window)) {
  Object.defineProperty(window, "ethereum", {
    value: provider,
    configurable: true,
    // Writable, so a wallet whose script runs after Tera's can still take it.
    writable: true,
  });
  window.dispatchEvent(new Event("ethereum#initialized"));
}

queueMicrotask(() => emit("connect", { chainId: CHAIN_HEX }));

export {};
