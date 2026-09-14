# Tera Wallet · Frontend Integration Guide

> **Base URL (Production)**: `https://api.terawallet.app`  
> **Render Fallback URL**: `https://terrawallet-backend-latest.onrender.com`  
> **Local Development URL**: `http://localhost:3001`  
> **Robinhood Chain Mainnet ID**: `4663` (`https://rpc.mainnet.chain.robinhood.com`)  
> **Block Explorer**: [https://robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)

---

## 1. Core Architecture & Mental Model

Tera Wallet uses the **Prepared Transaction Pattern** for supervised Real-World Asset (RWA) and tokenized equity actions on Robinhood Chain:

1. **Zero Custom Contract Deployments Needed**:
   - The user connects their standard wallet (MetaMask, Rainbow, Robinhood Wallet).
   - Execution targets the **canonical on-chain contracts already deployed on Robinhood Chain** (Uniswap V4 Universal Router for swaps, official token contracts for transfers).
2. **Backend Signs Nothing that Costs Gas**:
   - The backend has **zero private keys with gas funds** and never submits transactions to the chain.
   - The backend acts as a deterministic compiler & security gatekeeper.
3. **5 Deterministic Security Gates**:
   - Gate 1: **Asset Registry** (is the token verified in the approved Robinhood catalog?)
   - Gate 2: **Eligibility Preflight** (token transferability check)
   - Gate 3: **Policy Vault** (private spend limits, daily and single trade caps stored in DB)
   - Gate 4: **Risk Engine** (slippage verification, price bounds, non-zero amount)
   - Gate 5: **Approval Controller** (prompts user wallet signature)
4. **User Approves & Pays Gas Directly**:
   - Backend returns `preparedTransaction` (`{ to, data, value, chainId, actionHash }`).
   - The frontend calls standard Wagmi/Viem `sendTransaction({ to, data, value })`.
   - The user's wallet pops up, they confirm, and pay gas directly.
5. **Receipt Recorded in Audit Trail**:
   - Frontend calls `POST /api/intent/receipt` with `{ actionHash, txHash, recipient }` to record confirmed execution.

```
┌─────────────────────────┐         ┌──────────────────────────────┐         ┌────────────────────────┐
│      Frontend / UI      │ ──────► │   Backend (api.terawallet)   │ ──────► │ User Wallet (Metamask) │
│ (TanStack Start / Wagmi)│ ◄────── │(5 Gates → Prepared Tx Calldata) ◄────── │ (Owner signs & pays gas│
└────────────┬────────────┘         └──────────────────────────────┘         └───────────┬────────────┘
             │                                                                           │
             │                           txHash                                          │
             └───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Supported Robinhood Chain Assets (Chain ID: 4663)

All assets below are live on Robinhood Chain Mainnet:

| Symbol | Name | Contract Address | Decimals | Category |
|---|---|---|---|---|
| **`USDG`** | Global Dollar (Paxos) | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | 6 | `stablecoin` |
| **`ETH`** | Ether (Native) | `0x0000000000000000000000000000000000000000` | 18 | `native` |
| **`WETH`** | Wrapped Ether | `0x0bd7d308f8e1639fab988df18a8011f41eacad73` | 18 | `native` |
| **`SPCX`** | SpaceX Token | `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa` | 18 | `equity` |
| **`AAPL`** | Apple Inc. Token | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | 18 | `equity` |
| **`TSLA`** | Tesla Inc. Token | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | 18 | `equity` |
| **`NVDA`** | NVIDIA Corp. Token | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | 18 | `equity` |
| **`GOOGL`** | Alphabet Inc. Token | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` | 18 | `equity` |
| **`AMZN`** | Amazon.com Inc. Token | `0x12f190a9F9d7D37a250758b26824B97CE941bF54` | 18 | `equity` |
| **`MSFT`** | Microsoft Corp. Token | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | 18 | `equity` |
| **`META`** | Meta Platforms Token | `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` | 18 | `equity` |
| **`COIN`** | Coinbase Global Token | `0x6330D8C3178a418788dF01a47479c0ce7CCF450b` | 18 | `equity` |
| **`PLTR`** | Palantir Tech Token | `0xd58319690185984605929F52745330e7ea20D0C4` | 18 | `equity` |

* **Canonical Uniswap V4 Universal Router**: `0x8876789976decbfcbbbe364623c63652db8c0904`
* **Canonical Permit2**: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

---

## 3. API Reference & Payloads

### 1. AI Agent Proposal (Natural Language Intent)
Translates user conversational input into a structured intent and evaluates all 5 gates.

* **Endpoint**: `POST /api/agent/propose`
* **Request Body**:
```json
{
  "prompt": "Buy $250 worth of SpaceX stock on Robinhood Chain",
  "ownerAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "accountAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" // optional, defaults to ownerAddress
}
```
* **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "explanation": "Drafted proposal to BUY $250 worth of SPCX (SpaceX) on Robinhood Chain. Verified through deterministic compliance checks before owner signature.",
  "intent": {
    "ownerAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "accountAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "assetAddress": "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
    "actionType": "BUY",
    "amount": "250000000000000000000",
    "maxSpendUsdCents": 25000
  },
  "gates": [
    { "gate": "asset_registry", "passed": true },
    { "gate": "eligibility_preflight", "passed": true },
    { "gate": "policy_vault", "passed": true },
    { "gate": "risk_engine", "passed": true },
    { "gate": "approval_controller", "passed": true, "details": { "requiresOwnerSignature": true } }
  ],
  "preparedTransaction": {
    "to": "0x8876789976decbfcbbbe364623c63652db8c0904", // Canonical Universal Router
    "data": "0x...",
    "value": "0x0",
    "chainId": 4663,
    "actionHash": "0x8f2a..."
  }
}
```

---

### 2. Prepare Typed Intent Directly
* **Endpoint**: `POST /api/intent/prepare`
* **Request Body**:
```json
{
  "ownerAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "accountAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "assetAddress": "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
  "actionType": "BUY", // "BUY" | "SELL" | "TRANSFER" | "CLAIM_YIELD"
  "amount": "100000000000000000000", // in atomic token units (18 decimals for equities)
  "maxSpendUsdCents": 10000
}
```
* **Gate Rejection Response (`422 Unprocessable Entity`)**:
```json
{
  "success": false,
  "error": "Proposal exceeds owner maximum single-trade limit of $10000",
  "gates": [
    { "gate": "asset_registry", "passed": true },
    { "gate": "eligibility_preflight", "passed": true },
    { "gate": "policy_vault", "passed": false, "reason": "Proposal exceeds owner maximum single-trade limit of $10000" }
  ]
}
```

---

### 3. Record Broadcast Receipt
Call this after the user signs and broadcasts the transaction in their wallet.

* **Endpoint**: `POST /api/intent/receipt`
* **Request Body**:
```json
{
  "actionHash": "0x8f2a...",
  "txHash": "0x4c3d...",
  "recipient": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
}
```
* **Response (`201 Created`)**:
```json
{
  "success": true,
  "receiptId": "0x91fa3...",
  "actionHash": "0x8f2a...",
  "txHash": "0x4c3d...",
  "status": "CONFIRMED"
}
```

---

### 4. Query Asset Registry
* **Get all assets**: `GET /api/assets`
* **Get single asset by symbol, alias, or address**: `GET /api/assets/SPCX` or `GET /api/assets/AAPL` or `GET /api/assets/SPACEX`
* **Run preflight check**: `POST /api/assets/preflight`
```json
{
  "assetAddress": "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
  "walletAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
}
```

---

### 5. Session Keys Management
Allow users to create and manage scoped session keys:

* **Store Active Session**: `POST /api/session/register`
* **List Account Sessions**: `GET /api/session/:accountAddress`
* **Instant One-Tap Revocation in DB**: `POST /api/session/revoke`
```json
{
  "accountAddress": "0x7099...",
  "sessionKeyAddress": "0x90F7..."
}
```

---

### 6. Account & Audit History
* **Register Account**: `POST /api/account/register` (`{ ownerAddress, accountAddress }`)
* **Account Stats & Overview**: `GET /api/account/:address`
* **Full Intent & Receipt History**: `GET /api/account/:address/history`

---

## 4. Frontend Code Integration Example (React / Wagmi)

```tsx
import React, { useState } from "react";
import { useAccount, useSendTransaction } from "wagmi";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://api.terawallet.app";

export function AgentTradeProposal() {
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<any>(null);

  async function handleAskAgent() {
    if (!address) return alert("Please connect wallet first");
    setLoading(true);

    try {
      // 1. Get structured proposal + 5-gate prepared transaction
      const res = await fetch(`${BACKEND_URL}/api/agent/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          ownerAddress: address,
          accountAddress: address,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        alert(`Blocked by Gate: ${data.error}`);
        return;
      }

      setProposal(data);
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveAndExecute() {
    if (!proposal?.preparedTransaction) return;

    try {
      const tx = proposal.preparedTransaction;

      // 2. User wallet popup to sign and broadcast tx directly (User pays gas)
      const hash = await sendTransactionAsync({
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value || 0),
      });

      // 3. Record confirmed receipt in audit history
      await fetch(`${BACKEND_URL}/api/intent/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionHash: tx.actionHash,
          txHash: hash,
          recipient: address,
        }),
      });

      alert(`Transaction confirmed! Tx Hash: ${hash}`);
      setProposal(null);
    } catch (err: any) {
      console.error("User rejected or execution failed:", err);
    }
  }

  return (
    <div className="p-4 border rounded-xl space-y-4">
      <input
        type="text"
        placeholder="e.g. Buy $100 of SpaceX stock"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="w-full p-2 border rounded"
      />
      <button onClick={handleAskAgent} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded">
        {loading ? "Evaluating 5 Gates..." : "Ask Agent"}
      </button>

      {proposal && (
        <div className="p-4 bg-gray-50 dark:bg-zinc-900 rounded space-y-2">
          <p className="text-sm font-medium">{proposal.explanation}</p>
          <div className="flex gap-2">
            {proposal.gates.map((g: any) => (
              <span key={g.gate} className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded">
                ✓ {g.gate}
              </span>
            ))}
          </div>
          <button onClick={handleApproveAndExecute} className="px-4 py-2 bg-emerald-600 text-white rounded font-medium">
            Approve & Execute (User Pays Gas)
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 5. Summary for Frontend Developer

1. **Endpoint**: Point all API calls to `https://api.terawallet.app`.
2. **CORS**: Pre-configured and verified (`Access-Control-Allow-Origin: *`).
3. **Zero Contract Deployments Needed**: All prepared transactions point directly to the canonical Universal Router or token contracts.
4. **No Relayer / Bundler Keys**: The user wallet pays gas directly on Robinhood Chain Mainnet (`4663`).
