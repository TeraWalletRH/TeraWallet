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
    label: "The message you typed",
    detail:
      "With prompt minimisation on, addresses, references, contact details and figures are replaced with placeholders before an assistant message is sent. The original text and the mapping back to it stay in this page, and the reply is re-hydrated here.",
  },
  {
    label: "Recovery phrases, private keys and credentials",
    detail:
      "A message carrying one is refused at the composer before anything else runs. It is not minimised, not parsed, not shown to the on-device model, not sent, and not written to the log below — a record that a phrase was blocked is a smaller secret than the phrase, but it is still one.",
  },
  {
    label: "Questions answered from this wallet's own code",
    detail:
      "Questions with an exact answer in the wallet's source — what each check evaluates, what a wipe cannot reach, what a relay learns — are answered from that source on this device. No model runs and no request is built, and the answer names the file it came from so you can read it yourself.",
  },
  {
    label: "Questions answered by the on-device model",
    detail:
      "With the on-device engine selected, a question is answered by a model running in this tab and no request is built at all. It cannot prepare a proposal, so preparing one still goes to Tera's assistant service.",
  },
  {
    label: "Transaction records",
    detail:
      "Drafts and transaction records are encrypted in this browser after you unlock the local vault with a wallet signature. The decrypted key stays only in page memory.",
  },
  {
    label: "Proposal version history",
    detail:
      "Each earlier version of a proposal — amount, recipient, asset, check results and expiry — kept in the encrypted local vault so you can see what changed. No version is sent to the service.",
  },
  {
    label: "Connected session token",
    detail:
      "Kept only in the encrypted local vault after you connect it. It is sent to Tera only when you prepare an assistant proposal and is never sent to the model provider.",
  },
  {
    label: "Your balance-read endpoint",
    detail:
      "If you point balance reads at your own node, the address is kept in the encrypted local vault because it can carry your API key. Tera never receives it, and only its host is ever displayed or exported.",
  },
  {
    label: "What your holdings are worth",
    detail:
      "The price list covers every asset in the registry and is fetched without an address, so it cannot say which of them are yours. Multiplying it by your balances happens in this page. No total, no holding and no list of symbols is ever sent to be valued — which is how the same figure is produced everywhere else.",
  },
  {
    label: "Which of your accounts have been joined up, and by whom",
    detail:
      "Switching accounts does not separate them: a party that reads for two of them holds the fact that they are one person. That is counted in this page, per pair, for this session only — never the vault, never browser storage. A stored list of your accounts with a note of who saw each would be the same record the count exists to warn you about. A reload empties it, which does not mean the operators forgot.",
  },
  {
    label: "A request that would name two of your accounts",
    detail:
      "Refused before it is built, so it is not sent and does not appear in the log below — a row saying which two accounts were nearly joined is a smaller version of the same record. Allowing one is a switch in Settings that starts off and goes back off when the page reloads.",
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
    id: "bridge-quote",
    method: "POST",
    path: "/api/bridge/quote",
    match: (path) => path === "/api/bridge/quote",
    label: "Bridge quote",
    purpose: "Quote a USDG bridge to the destination address you entered.",
    fields: ["ownerAddress", "recipient", "amount", "destinationChainId"],
    identifies: true,
    processors: ["Tera service", "Relay"],
    retention:
      "Relay receives the source and destination addresses and amount. Bridge tracking is saved locally in the encrypted vault when unlocked.",
    withheld: ["Assistant messages", "Session token", "Private keys", "Portfolio"],
  },
  {
    id: "bridge-status",
    method: "GET",
    path: "/api/bridge/status/{reference}",
    match: (path) => /^\/api\/bridge\/status\/0x[\da-f]{64}$/i.test(path),
    label: "Bridge delivery",
    purpose: "Check destination delivery or refund using the Relay request reference.",
    fields: ["requestId (in the request path)"],
    identifies: true,
    processors: ["Tera service", "Relay"],
    retention: "Relay looks up its bridge record using this reference.",
    withheld: ["Assistant messages", "Session token", "Private keys"],
  },
  {
    id: "policy-bundle",
    method: "GET",
    path: "/policy-bundle.json",
    match: (path) => path === "/policy-bundle.json",
    label: "Signed policy bundle",
    purpose: "Load the public rules evaluated in this wallet before proposal preparation.",
    fields: [],
    identifies: false,
    processors: ["Tera service"],
    retention: "No wallet address, amount, or proposal data is sent with this read.",
    withheld: ["Wallet address", "Balances", "Amounts", "Assistant messages", "Private keys"],
  },
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
    id: "asset-prices",
    method: "GET",
    path: "/api/assets/prices",
    match: (path) => path === "/api/assets/prices",
    label: "Asset prices",
    purpose:
      "Load the price of every asset in the registry. Not the price of what you hold: this request carries nothing, so it is the same request whoever makes it, and what you own is multiplied out on this device.",
    fields: [],
    identifies: false,
    processors: ["Tera service", "Public market data API, for ETH only"],
    retention:
      "No owner data is sent, so there is nothing to retain for this request. Tera caches one answer for thirty seconds and serves it to everybody, so the market API behind the ETH price sees Tera asking twice a minute and never sees a user.",
    withheld: ["Wallet address", "Balances", "Which assets you hold", "Assistant messages"],
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
      "The message text is sent to Tera's model provider to generate the reply. With prompt minimisation on, what is sent is the placeholder skeleton and not the text you typed. Your wallet address is not part of this request.",
    withheld: [
      "Wallet address",
      "Balances",
      "Proposal history",
      "Local transaction records",
      "Values replaced by prompt minimisation",
    ],
  },
  {
    id: "agent-propose",
    method: "POST",
    path: "/api/agent/propose",
    match: (path) => path === "/api/agent/propose",
    label: "Assistant proposal",
    purpose: "Draft a typed proposal from your description and run the checks.",
    fields: ["prompt", "ownerAddress", "sessionToken"],
    identifies: true,
    processors: ["Tera service", "Assistant model provider"],
    retention:
      "The prompt text reaches the model provider. Prompt minimisation removes contact details, references and call data from it, but keeps the recipient address and the figure, because Tera reads those out of the text to build the transaction. The address and optional session token stay with Tera for scope checks and the resulting intent record.",
    withheld: [
      "Balances",
      "Local transaction records",
      "Private keys",
      "Session token from the model provider",
    ],
  },
  {
    id: "retention-delete",
    method: "DELETE",
    path: "/api/account/{address}/assistant-data",
    match: (path) => /^\/api\/account\/0x[\da-f]{40}\/assistant-data$/i.test(path),
    label: "Assistant data deletion",
    purpose: "Delete stored unconfirmed assistant proposal data after wallet authorization.",
    fields: ["ownerAddress (in the request path)", "wallet signature", "timestamp"],
    identifies: true,
    processors: ["Tera service"],
    retention:
      "Stored assistant proposal fields are redacted; confirmed transaction receipts remain for audit history.",
    withheld: ["Private keys", "Seed phrase"],
  },
  {
    id: "privacy-audit",
    method: "GET",
    path: "/api/privacy/audit",
    match: (path) => path.startsWith("/api/privacy/audit"),
    label: "Privacy audit report",
    purpose:
      "Retrieve a machine-readable record of data categories collected, retention periods, processors, and deletion status.",
    fields: [],
    identifies: false,
    processors: ["Tera service"],
    retention: "Read-only disclosure endpoint.",
    withheld: ["Private keys", "Seed phrase", "Wallet balances"],
  },
  {
    id: "account-privacy-audit",
    method: "GET",
    path: "/api/account/{address}/privacy-audit",
    match: (path) => /^\/api\/account\/0x[\da-f]{40}\/privacy-audit$/i.test(path),
    label: "Account privacy audit",
    purpose: "Retrieve real-time data retention and deletion status for this wallet.",
    fields: ["ownerAddress (in the request path)"],
    identifies: true,
    processors: ["Tera service"],
    retention: "Read-only status lookup.",
    withheld: ["Private keys", "Seed phrase", "Balances"],
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
    // A turn answered by the on-device model is in this log so its absence is
    // visible, but it is not a request and is never counted as one.
    requests: log.filter((entry) => !entry.onDevice).length,
    onDevice: log.filter((entry) => entry.onDevice).length,
    // Simulated entries were answered locally and never reached the network.
    simulated: log.filter((entry) => entry.simulated).length,
    identifying: log.filter((entry) => entry.identifies).length,
    toModelProvider: log.filter((entry) => entry.processors.includes("Assistant model provider"))
      .length,
    // Values replaced on this device before the request was built.
    minimised: log.filter((entry) => entry.minimised).length,
    // Sealed to Tera's gateway key and sent via a relay, so Tera answered them
    // without learning the network address they came from.
    oblivious: log.filter((entry) => entry.oblivious).length,
    replaced: log.reduce((total, entry) => total + (entry.replaced || 0), 0),
    fields: new Set(log.filter((entry) => !entry.onDevice).flatMap((entry) => entry.sent)).size,
  };
}

export function exportable(log, destination) {
  return {
    generatedAt: new Date().toISOString(),
    destination,
    note: "Field names only. This page never records the values that were sent. A request marked as sealed reached Tera through a relay, so Tera read its contents without learning the network address it came from.",
    requests: log.map((entry) => ({
      at: new Date(entry.at).toISOString(),
      request: entry.label,
      method: entry.method,
      path: entry.path,
      fieldsSent: entry.sent,
      simulated: Boolean(entry.simulated),
      minimisedBeforeSending: Boolean(entry.minimised),
      sealedThroughRelay: Boolean(entry.oblivious),
      ...(entry.oblivious ? { relayHost: entry.relayHost } : {}),
      valuesReplacedOnDevice: entry.replaced || 0,
      processors: entry.processors,
      retention: entry.retention,
      withheldFromThisRequest: entry.withheld,
    })),
  };
}
