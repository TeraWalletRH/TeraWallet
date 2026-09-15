// The privacy status centre describes every request this page can make and records
// what actually left the device. Only field names are ever recorded, never values.

export const LOCAL_ONLY = [
  {
    label: "Private keys and signatures",
    detail: "Held by your wallet extension. Tera never receives a key or a seed phrase.",
  },
  {
    label: "Token balances",
    detail:
      "Read through your wallet's own network provider with eth_getBalance and eth_call. Balances are not sent to Tera.",
  },
  {
    label: "Proposals and assistant messages in view",
    detail: "Kept in this page session only. Reloading the page clears them.",
  },
  {
    label: "Transaction records",
    detail:
      "Transaction hash, action reference, target, status and audit-sync flag saved in this browser's local storage, scoped to this wallet and network.",
  },
  {
    label: "Balance visibility and filters",
    detail: "Interface state that stays in the page and is never transmitted.",
  },
];

// Each entry documents one request the wallet can make. `fields` lists what the
// request can carry; the live log records the field names actually present.
export const REQUESTS = [
  {
    id: "assets",
    method: "GET",
    path: "/api/assets",
    match: (path) => path === "/api/assets",
    label: "Asset registry",
    purpose: "Load the list of supported assets.",
    fields: [],
    identifies: false,
    processors: ["Tera service"],
    retention: "No owner data is sent, so there is nothing to retain for this request.",
    withheld: ["Wallet address", "Balances", "Proposal history"],
  },
  {
    id: "account-register",
    method: "POST",
    path: "/api/account/register",
    match: (path) => path === "/api/account/register",
    label: "Account record",
    purpose: "Register the connected address so proposals can be tracked.",
    fields: ["ownerAddress", "accountAddress", "chainId"],
    identifies: true,
    processors: ["Tera service"],
    retention: "Kept in Tera's account record until deletion controls are available.",
    withheld: ["Balances", "Assistant messages", "Private keys"],
  },
  {
    id: "account-read",
    method: "GET",
    path: "/api/account/{address}",
    match: (path) => /^\/api\/account\/0x[\da-f]{40}$/i.test(path),
    label: "Account lookup",
    purpose: "Read the intent counters Tera reports for this address.",
    fields: ["ownerAddress (in the request path)"],
    identifies: true,
    processors: ["Tera service"],
    retention: "Read-only lookup. The address appears in the service's request logs.",
    withheld: ["Balances", "Assistant messages", "Local transaction records"],
  },
  {
    id: "account-history",
    method: "GET",
    path: "/api/account/{address}/history",
    match: (path) => /^\/api\/account\/0x[\da-f]{40}\/history$/i.test(path),
    label: "Account history",
    purpose: "Read the intent history Tera holds for this address.",
    fields: ["ownerAddress (in the request path)"],
    identifies: true,
    processors: ["Tera service"],
    retention: "Read-only lookup against records Tera already holds.",
    withheld: ["Balances", "Assistant messages", "Local transaction records"],
  },
  {
    id: "session-read",
    method: "GET",
    path: "/api/session/{address}",
    match: (path) => /^\/api\/session\/0x[\da-f]{40}$/i.test(path),
    label: "Session lookup",
    purpose: "Read agent session records reported for this address.",
    fields: ["ownerAddress (in the request path)"],
    identifies: true,
    processors: ["Tera service"],
    retention: "Read-only lookup against records Tera already holds.",
    withheld: ["Balances", "Private policy", "Private keys"],
  },
  {
    id: "assets-preflight",
    method: "POST",
    path: "/api/assets/preflight",
    match: (path) => path === "/api/assets/preflight",
    label: "Transfer preflight",
    purpose: "Ask whether this asset reports a transfer restriction for this address.",
    fields: ["assetAddress", "walletAddress"],
    identifies: true,
    processors: ["Tera service"],
    retention: "Checked when you ask. The address appears in the service's request logs.",
    withheld: ["Amount", "Recipient", "Balances"],
  },
  {
    id: "intent-prepare",
    method: "POST",
    path: "/api/intent/prepare",
    match: (path) => path === "/api/intent/prepare",
    label: "Proposal preparation",
    purpose: "Run the five checks and build the transaction you review.",
    fields: [
      "ownerAddress",
      "accountAddress",
      "assetAddress",
      "actionType",
      "amount",
      "recipient",
      "maxSpendUsdCents",
    ],
    identifies: true,
    processors: ["Tera service"],
    retention: "Stored as an intent record with the action reference until deletion controls ship.",
    withheld: ["Balances", "Assistant messages", "Private keys"],
  },
  {
    id: "intent-receipt",
    method: "POST",
    path: "/api/intent/receipt",
    match: (path) => path === "/api/intent/receipt",
    label: "Receipt audit sync",
    purpose: "Record that an approved transaction reached the chain.",
    fields: ["actionHash", "txHash", "recipient"],
    identifies: true,
    processors: ["Tera service"],
    retention: "Stored as a receipt record until deletion controls ship.",
    withheld: ["Balances", "Assistant messages", "Private keys"],
  },
  {
    id: "agent-chat",
    method: "POST",
    path: "/api/agent/chat",
    match: (path) => path === "/api/agent/chat",
    label: "Assistant question",
    purpose: "Answer a question about assets and the approval flow.",
    fields: ["message"],
    identifies: false,
    processors: ["Tera service", "Assistant model provider"],
    retention:
      "The message text is sent to Tera's model provider to generate the reply. Your wallet address is not part of this request.",
    withheld: ["Wallet address", "Balances", "Proposal history", "Local transaction records"],
  },
  {
    id: "agent-propose",
    method: "POST",
    path: "/api/agent/propose",
    match: (path) => path === "/api/agent/propose",
    label: "Assistant proposal",
    purpose: "Draft a typed proposal from your description and run the checks.",
    fields: ["prompt", "ownerAddress", "accountAddress"],
    identifies: true,
    processors: ["Tera service", "Assistant model provider"],
    retention:
      "The prompt text reaches the model provider. The address stays with Tera for the checks and the resulting intent record.",
    withheld: ["Balances", "Local transaction records", "Private keys"],
  },
];

const UNKNOWN = {
  id: "unknown",
  label: "Other service request",
  purpose: "A request this page does not document.",
  fields: [],
  identifies: false,
  processors: ["Tera service"],
  retention: "Not documented. Treat the fields recorded in the log as sent.",
  withheld: [],
};

export function requestProfile(path) {
  return REQUESTS.find((entry) => entry.match(path)) || UNKNOWN;
}

// A path can carry the owner's address or a transaction hash. The log stores the
// documented template so reading it never exposes who made the request.
export function redactPath(path) {
  return String(path).replace(/0x[\da-f]+/gi, "{value}");
}

// Record the shape of a request, never its values: only top-level key names are
// kept, so no address, amount or message text is ever written to the log.
export function fieldNames(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.entries(body)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
}

export function describeRequest(path, body, at = Date.now()) {
  const profile = requestProfile(path);
  // A GET carries the address in its path, so the documented profile, not the
  // empty body, decides whether the request identifies the owner.
  return {
    id: profile.id,
    label: profile.label,
    purpose: profile.purpose,
    method: body === undefined ? "GET" : "POST",
    path: profile.path || redactPath(path),
    sent: body === undefined ? profile.fields : fieldNames(body),
    identifies: profile.identifies,
    processors: profile.processors,
    retention: profile.retention,
    withheld: profile.withheld,
    at,
  };
}

export function appendLog(log, entry, limit = 60) {
  return [entry, ...log].slice(0, limit);
}

export function summarize(log) {
  return {
    requests: log.length,
    // Simulated entries were answered locally and never reached the network.
    simulated: log.filter((entry) => entry.simulated).length,
    identifying: log.filter((entry) => entry.identifies).length,
    toModelProvider: log.filter((entry) => entry.processors.includes("Assistant model provider"))
      .length,
    fields: new Set(log.flatMap((entry) => entry.sent)).size,
  };
}

export function exportable(log, destination) {
  return {
    generatedAt: new Date().toISOString(),
    destination,
    note: "Field names only. This page never records the values that were sent.",
    requests: log.map((entry) => ({
      at: new Date(entry.at).toISOString(),
      request: entry.label,
      method: entry.method,
      path: entry.path,
      fieldsSent: entry.sent,
      simulated: Boolean(entry.simulated),
      processors: entry.processors,
      retention: entry.retention,
      withheldFromThisRequest: entry.withheld,
    })),
  };
}
