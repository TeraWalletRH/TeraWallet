// Spreading the wallet's reads across several public nodes. No network
// access of its own; android/src/network.ts does the requests.
//
// A wallet refreshes its balances every few seconds while open, and each
// refresh names the wallet's address. Sent to one node, that is a complete
// record of when this address is in use, from where, and what it checks.
// Rotated across several independent operators, each sees a share of it and
// none sees the whole pattern.
//
// The rules, each one a test:
//
//   Reads take turns: each request starts at the next node in the list and
//   falls through to the others only if that node fails.
//
//   Some requests stay on the first node, the network's own: log searches,
//   whose block-range limits differ between operators, and anything that
//   sends — a signed transaction must not be handed to whichever node is
//   next, and its nonce and receipt have to come from the node that saw it.
//
//   A node failing (unreachable, timing out, rate-limiting, erroring
//   internally) moves the request to the next node. A node answering — even
//   with an error such as a reverted call — is the answer, and is not asked
//   again elsewhere: a revert is the chain's verdict, not a node fault.
//
//   Rotation can be turned off, and then every read goes to the first node.

/** Methods that always go to the first node first. */
export const PINNED = new Set([
  "eth_getLogs",
  "eth_sendRawTransaction",
  "eth_sendTransaction",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_newFilter",
  "eth_getFilterChanges",
  "eth_getFilterLogs",
]);

/**
 * A rotation over `count` nodes. `next(method, on)` gives the order to try
 * them in, as indexes into the node list.
 */
export function createRotation(count) {
  if (!Number.isInteger(count) || count < 1) throw new Error("A rotation needs at least one node.");
  let turn = 0;
  return {
    next(method, on = true) {
      const start = on && !PINNED.has(method) ? turn++ % count : 0;
      return Array.from({ length: count }, (_, i) => (start + i) % count);
    },
  };
}

// JSON-RPC codes that describe the node, not the request.
const NODE_CODES = new Set([-32005, -32603, -32601, -32002, -32004, 429]);
const NODE_NAMES = new Set([
  "HttpRequestError",
  "TimeoutError",
  "LimitExceededRpcError",
  "InternalRpcError",
  "MethodNotSupportedRpcError",
  "MethodNotFoundRpcError",
  "ResourceUnavailableRpcError",
  "UnknownRpcError",
  "TypeError",
  "AbortError",
]);

/** True when an error means "try another node", false when it is the answer. */
export function isNodeFault(error) {
  for (let e = error, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (NODE_NAMES.has(e.name)) return true;
    if (NODE_CODES.has(e.code)) return true;
    if (typeof e.status === "number" && (e.status === 429 || e.status >= 500)) return true;
  }
  return false;
}

/** The node list: the network's own first, then the others, without repeats or blanks. */
export function nodeList(primary, others = []) {
  return [primary, ...others]
    .map((url) => String(url ?? "").trim())
    .filter((url, i, all) => url && all.indexOf(url) === i);
}
