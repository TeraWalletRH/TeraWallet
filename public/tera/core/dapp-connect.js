// Connecting websites to the Tera browser extension. No platform API of its
// own; extension/src/background.ts asks these rules and does the rest.
//
// A site sees nothing until the owner says so. The rules, each one a test:
//
//   Only real sites can connect: https pages, and http on this computer
//   (localhost, 127.0.0.1, [::1]) for people building a site. Anything else
//   (file pages, http on the open internet, other extensions) gets no
//   address, ever: a page the network can rewrite in transit could ask in
//   the owner's name.
//
//   A connection belongs to one origin. https://app.example and
//   https://evil.app.example are different sites, and so are http and https
//   of the same name.
//
//   Before connecting a site learns the network and can read the chain
//   (balances, contract calls) like any public block explorer, but
//   eth_accounts is empty. After, it gets the one address it was given.
//   Disconnecting takes the address back immediately.
//
//   Signing messages and typed data has its own rules (core/dapp-sign.js).
//   Sending transactions is not in this version: it is refused with the
//   standard "unsupported" error rather than pretended.
//
//   Tera is a Robinhood Chain wallet. Switching to it succeeds; switching to
//   anything else is refused with the standard "unrecognized chain" error,
//   and adding networks is not offered.
//
//   Wrong passwords slow down: five free tries, then a wait that doubles
//   from 30 seconds up to 15 minutes.

export const CHAIN_ID = 4663;
export const CHAIN_HEX = "0x" + CHAIN_ID.toString(16);

/** EIP-1193 and JSON-RPC error codes. */
export const ERRORS = {
  rejected: 4001,
  unauthorized: 4100,
  unsupported: 4200,
  disconnected: 4900,
  pending: -32002,
  unrecognizedChain: 4902,
  invalidRequest: -32600,
  invalidParams: -32602,
  internal: -32603,
};

export function rpcError(code, message) {
  return { code, message };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The origin a page may connect as, or "" when it may not connect at all. */
export function siteOrigin(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ""));
  } catch {
    return "";
  }
  if (parsed.protocol === "https:") return parsed.origin;
  if (parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname)) return parsed.origin;
  return "";
}

/** Read-only chain methods a site may call, connected or not. */
export const READS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "net_version",
  "web3_clientVersion",
]);

/** Methods that sign. core/dapp-sign.js decides which are offered. */
export const SIGNING = new Set([
  "eth_sendTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTransaction",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "eth_sendRawTransaction",
  "wallet_sendCalls",
]);

const OWN = {
  eth_accounts: "accounts",
  eth_coinbase: "accounts",
  eth_requestAccounts: "connect",
  wallet_requestPermissions: "connect",
  wallet_getPermissions: "permissions",
  wallet_revokePermissions: "revoke",
  eth_chainId: "chain",
  wallet_switchEthereumChain: "switch",
  wallet_addEthereumChain: "add",
};

/** What kind of request this is, which decides who answers it. */
export function classify(method) {
  if (Object.hasOwn(OWN, method)) return OWN[method];
  if (READS.has(method)) return "read";
  if (SIGNING.has(method)) return "signing";
  return "unsupported";
}

/** A request shaped the way EIP-1193 says, or the error explaining why not. */
export function checkRequest(request) {
  if (!request || typeof request !== "object")
    return rpcError(ERRORS.invalidRequest, "Expected a request object.");
  const { method, params } = request;
  if (typeof method !== "string" || !method || method.length > 100)
    return rpcError(ERRORS.invalidRequest, "Expected a method name.");
  if (params !== undefined && (params === null || typeof params !== "object"))
    return rpcError(ERRORS.invalidParams, "Params must be an array or an object.");
  return null;
}

/** The answer to wallet_switchEthereumChain. null means switched (already there). */
export function switchChain(params) {
  const id = Array.isArray(params) ? params[0]?.chainId : undefined;
  if (typeof id !== "string" || !/^0x[0-9a-fA-F]+$/.test(id))
    return rpcError(ERRORS.invalidParams, 'Expected [{ chainId: "0x…" }].');
  if (parseInt(id, 16) === CHAIN_ID) return null;
  return rpcError(ERRORS.unrecognizedChain, "Tera Wallet only works on Robinhood Chain (4663).");
}

/** Sites with `origin` connected to `accounts`. Returns a new object. */
export function grant(sites, origin, accounts, now = Date.now()) {
  if (!siteOrigin(origin) || siteOrigin(origin) !== origin)
    throw new Error("Not a site that can connect.");
  return { ...sites, [origin]: { accounts: [...accounts], connectedAt: now } };
}

/** Sites without `origin`. Returns a new object. */
export function revoke(sites, origin) {
  const next = { ...sites };
  delete next[origin];
  return next;
}

/** The addresses `origin` may see: [] unless connected. */
export function accountsFor(sites, origin) {
  const site = sites?.[origin];
  return site && Array.isArray(site.accounts) ? [...site.accounts] : [];
}

/** The answer to wallet_getPermissions. */
export function permissionsFor(sites, origin) {
  const accounts = accountsFor(sites, origin);
  if (!accounts.length) return [];
  return [
    {
      parentCapability: "eth_accounts",
      invoker: origin,
      date: sites[origin].connectedAt,
      caveats: [{ type: "restrictReturnedAccounts", value: accounts }],
    },
  ];
}

/** Connected sites, newest first, for the popup's list. */
export function listSites(sites) {
  return Object.entries(sites || {})
    .map(([origin, site]) => ({ origin, ...site }))
    .sort((a, b) => (b.connectedAt || 0) - (a.connectedAt || 0));
}

export const FREE_TRIES = 5;
const FIRST_WAIT = 30_000;
const LONGEST_WAIT = 15 * 60_000;

/** How long to wait before the next password try, after `failures` wrong ones. */
export function passwordWait(failures) {
  if (failures < FREE_TRIES) return 0;
  return Math.min(LONGEST_WAIT, FIRST_WAIT * 2 ** (failures - FREE_TRIES));
}
