// Guided private demo mode. Everything here is local: no request reaches the
// network and no transaction can be signed, so the full privacy boundary can be
// shown without a real account. Sample addresses are documentation values.

import { snapshot } from "./history.js";

export const DEMO_OWNER = "0xde300000000000000000000000000000000000a1";
export const DEMO_LINEAGE = "tera-demo-lineage";
const DEMO_USDG = "0xde300000000000000000000000000000000000b2";
const DEMO_SPCX = "0xde300000000000000000000000000000000000c3";
const DEMO_RECIPIENT = "0xde300000000000000000000000000000000000d4";
const DEMO_SESSION_KEY = "0xde300000000000000000000000000000000000e5";
const DEMO_NATIVE = `0x${"0".repeat(40)}`;
const DEMO_ACTION_HASH = `0xde30${"0".repeat(56)}a1b2`;

export class DemoSignatureBlocked extends Error {
  constructor() {
    // No wallet error code: this is the demo boundary, not a declined request,
    // and it must not be reported as one.
    super(
      "Demo mode stops here. This is the moment authority moves to your wallet, and the guided demo never asks a real wallet to sign.",
    );
  }
}

export const DEMO_ASSETS = [
  {
    symbol: "USDG",
    name: "Sample settlement dollar",
    address: DEMO_USDG,
    decimals: 6,
    category: "stablecoin",
    issuer: "Sample issuer · demo data",
    status: "ACTIVE",
    description: "Settlement asset used by the guided demo. Not a real token.",
  },
  {
    symbol: "SPCX",
    name: "Sample private-markets note",
    address: DEMO_SPCX,
    decimals: 18,
    category: "equity",
    issuer: "Sample issuer · demo data",
    status: "ACTIVE",
    description: "Sample tokenized asset used by the guided demo. Not a real token.",
  },
  {
    symbol: "ETH",
    name: "Sample network gas token",
    address: DEMO_NATIVE,
    decimals: 18,
    category: "native",
    issuer: "Sample issuer · demo data",
    status: "ACTIVE",
    description: "Stands in for the native token so gas can be shown. Not a real balance.",
  },
];

// Balances are answered by the demo provider, mirroring how the live wallet
// reads them from its own network provider rather than from Tera.
const DEMO_BALANCES = {
  [DEMO_USDG]: 4820_000000n,
  [DEMO_SPCX]: 125_000000000000000000n,
  [DEMO_NATIVE]: 1_450000000000000000n,
};

const DEMO_GATES = [
  { gate: "asset_registry", passed: true, reason: "Asset is listed in the sample registry." },
  {
    gate: "eligibility_preflight",
    passed: true,
    reason: "Sample issuer reports no transfer restriction for this address.",
  },
  {
    gate: "policy_vault",
    passed: true,
    reason: "Within the sample per-action limit. The limit itself was not sent to the assistant.",
  },
  { gate: "risk_engine", passed: true, reason: "Recipient and amount match the reviewed action." },
  { gate: "approval_controller", passed: true, reason: "Waiting for the owner signature." },
];

const BLOCKED_GATES = [
  DEMO_GATES[0],
  DEMO_GATES[1],
  {
    gate: "policy_vault",
    passed: false,
    reason:
      "Above the sample per-action limit of 1,000 USDG. The assistant was told only that the rule failed.",
  },
  DEMO_GATES[3],
  DEMO_GATES[4],
];

function demoIntent(overrides = {}) {
  return {
    ownerAddress: DEMO_OWNER,
    accountAddress: DEMO_OWNER,
    assetAddress: DEMO_USDG,
    actionType: "TRANSFER",
    amount: "250000000",
    recipient: DEMO_RECIPIENT,
    ...overrides,
  };
}

function transferCalldata(intent) {
  return `0xa9059cbb${intent.recipient.slice(2).toLowerCase().padStart(64, "0")}${BigInt(
    intent.amount,
  )
    .toString(16)
    .padStart(64, "0")}`;
}

// A proposal that passes every check, so the demo can reach the approval
// boundary and stop there.
export function demoProposal(chainId, intentOverrides = {}, blocked = false) {
  const intent = demoIntent(intentOverrides);
  const gates = blocked ? BLOCKED_GATES : DEMO_GATES;
  if (blocked)
    return {
      success: false,
      error: BLOCKED_GATES[2].reason,
      explanation:
        "The action was blocked before anything was prepared. The rule that failed stayed on your side of the boundary.",
      intent,
      gates,
    };
  return {
    success: true,
    explanation:
      "Prepared a sample transfer. Tera saw the asset, the amount and the recipient. It did not see your balances, your other holdings or your private limits.",
    intent,
    gates,
    preparedTransaction: {
      to: intent.assetAddress,
      data: transferCalldata(intent),
      value: "0x0",
      chainId,
      actionHash: DEMO_ACTION_HASH,
      intent,
    },
  };
}

const DEMO_REPLIES = {
  default:
    "In the guided demo nothing you type leaves this page. In the live wallet only your message text reaches the assistant service — your address, balances and private limits stay here.",
  privacy:
    "I never receive your balances, your holdings or your private policy. I receive the message you send and, when you ask for a proposal, the wallet address the checks need. Open **Privacy status** to see the exact fields.",
  proposal:
    "I have drafted a sample transfer for your review. Every check ran locally for this demo. Open **Approvals** to inspect the action, then approve it in your wallet — the demo stops at that boundary.",
};

export function demoReply(message = "") {
  const text = String(message).toLowerCase();
  if (/privacy|data|see|know|send/.test(text)) return DEMO_REPLIES.privacy;
  if (/transfer|send|buy|sell|propose|prepare/.test(text)) return DEMO_REPLIES.proposal;
  return DEMO_REPLIES.default;
}

// Answers every service path the wallet calls, without touching the network.
export function demoApi(path, body, chainId) {
  if (path === "/api/assets") return { success: true, assets: DEMO_ASSETS };
  if (path === "/api/account/register") return { success: true, registered: true };
  if (/^\/api\/account\/0x[\da-f]{40}\/history$/i.test(path))
    return {
      success: true,
      history: [
        {
          intent_type: "TRANSFER",
          status: "confirmed",
          created_at: "2026-09-12T09:24:00.000Z",
          tx_hash: `0xde30${"0".repeat(56)}f1f1`,
        },
        {
          intent_type: "TRANSFER",
          status: "prepared",
          created_at: "2026-09-14T16:02:00.000Z",
          tx_hash: null,
        },
      ],
    };
  if (/^\/api\/account\/0x[\da-f]{40}$/i.test(path))
    return {
      success: true,
      account: { ownerAddress: DEMO_OWNER, accountAddress: DEMO_OWNER, chainId },
      stats: { intents: { total_intents: 2, confirmed_intents: 1 } },
    };
  if (/^\/api\/session\/0x[\da-f]{40}$/i.test(path))
    return {
      success: true,
      sessions: [
        {
          session_key_address: DEMO_SESSION_KEY,
          scope: "TRANSFER",
          expires_at: "2026-09-17T12:00:00.000Z",
          is_revoked: false,
        },
      ],
    };
  if (path === "/api/assets/preflight")
    return {
      success: true,
      canTransfer: true,
      reason: "Sample issuer reports no restriction for this address.",
    };
  if (path === "/api/intent/prepare") return demoProposal(chainId, body);
  if (path === "/api/intent/receipt") return { success: true, receiptId: "demo-receipt-01" };
  if (path === "/api/agent/chat") return { success: true, reply: demoReply(body?.message) };
  if (path === "/api/agent/propose")
    return { ...demoProposal(chainId), explanation: demoReply(body?.prompt) };
  return { success: true };
}

// Mirrors the read-only calls the wallet makes through the owner's provider.
// Any method that would move value refuses, so the demo cannot sign.
export function createDemoProvider(chainId) {
  return {
    isTeraDemo: true,
    async request({ method, params }) {
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [DEMO_OWNER];
      if (method === "eth_getBalance") return `0x${DEMO_BALANCES[DEMO_NATIVE].toString(16)}`;
      if (method === "eth_getCode") return "0x60806040";
      if (method === "eth_estimateGas") return "0xc350";
      if (method === "eth_call") {
        const call = params?.[0] || {};
        const data = String(call.data || "");
        // balanceOf reads a sample balance; a transfer simulation succeeds.
        if (data.startsWith("0x70a08231")) {
          const balance = DEMO_BALANCES[call.to?.toLowerCase()] ?? 0n;
          return `0x${balance.toString(16).padStart(64, "0")}`;
        }
        return `0x${"0".repeat(63)}1`;
      }
      if (method === "eth_getTransactionReceipt") return null;
      if (method === "eth_sendTransaction" || method === "eth_signTransaction")
        throw new DemoSignatureBlocked();
      throw new Error(`The guided demo does not answer ${method}.`);
    },
  };
}

// The guided walkthrough. Each step names the page it belongs to so the guide
// can move the wallet there, and says what the step proves.
export const GUIDE = [
  {
    id: "boundary",
    route: "privacy",
    title: "Start at the boundary",
    body: "The demo just made the same calls a real connection makes — registry, account, history, sessions. Each is listed below with the fields it carries, and each was answered locally. Nothing left this page. Scroll to 'Who else can see you' for the parties a real session involves, and which of them would see the network address you are on.",
    action: "Open Privacy status",
  },
  {
    id: "ask",
    route: "agent",
    title: "Ask the assistant something",
    body: "Send a question with an address and a figure in it. Before anything is sent you are shown both sides — what you typed, and the skeleton that leaves this device with every value replaced by a placeholder. The reply is re-hydrated here. Then return to Privacy status: the request carries your message and nothing else. No address, no balances, no history.",
    action: "Open the assistant",
  },
  {
    id: "prepare",
    route: "approvals",
    title: "Prepare an action",
    body: "A proposal sends the asset, amount and recipient — the fields the checks need. Your balances are never part of it; the wallet reads those through its own network provider.",
    action: "Open Approvals",
  },
  {
    id: "gates",
    route: "approvals",
    title: "Read the checks",
    body: "Five checks run before anything reaches you. A blocked action tells the assistant only that a rule failed, never which limit you set or what it is.",
    action: "Stay on Approvals",
  },
  {
    id: "approve",
    route: "approvals",
    title: "Meet the signature boundary",
    body: "Approve the sample transfer. The demo stops at the exact moment authority moves from the assistant to your wallet, and signs nothing.",
    action: "Try the approval",
  },
  {
    id: "audit",
    route: "privacy",
    title: "Check the record",
    body: "Every request the demo answered is logged with its field names, marked as simulated. Export it: the log holds names, never values.",
    action: "Back to Privacy status",
  },
];

export function guideStep(index) {
  return GUIDE[Math.min(Math.max(index, 0), GUIDE.length - 1)];
}

export function createDemoState(chainId) {
  return {
    owner: DEMO_OWNER,
    provider: createDemoProvider(chainId),
    chain: chainId,
    assets: DEMO_ASSETS,
    assetsLoaded: true,
    assetError: "",
    account: demoApi(`/api/account/${DEMO_OWNER}`, undefined, chainId),
    history: demoApi(`/api/account/${DEMO_OWNER}/history`, undefined, chainId).history,
    sessions: demoApi(`/api/session/${DEMO_OWNER}`, undefined, chainId).sessions,
    balances: {},
    drafts: [
      { ...demoProposal(chainId), lineage: DEMO_LINEAGE },
      demoProposal(chainId, { amount: "2500000000" }, true),
    ],
    // The sample action was prepared once above the policy limit, then again
    // below it, so the guided demo can show a real local diff.
    versions: {
      [DEMO_LINEAGE]: [
        snapshot(
          demoProposal(chainId, { amount: "2500000000" }, true),
          DEMO_ASSETS[0],
          Date.now() - 9 * 60000,
        ),
      ],
    },
    records: [],
    chat: [{ role: "assistant", text: DEMO_REPLIES.default }],
    errors: {},
    query: "",
    category: "all",
    notice: "",
    loading: false,
    busy: false,
  };
}
