# Tera Wallet · Frontend Integration Guide

> **Base URL (Production / Render)**: `https://terrawallet-backend-latest.onrender.com`  
> **Base URL (Local)**: `http://localhost:3001`  
> **Robinhood Chain Mainnet ID**: `4663` (`https://rpc.mainnet.chain.robinhood.com`)  
> **Robinhood Chain Testnet ID**: `46630` (`https://testnet-rpc.robinhood.com`)  
> **Block Explorer**: [https://robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)

---

## 1. Core Architecture & Mental Model

Tera Wallet uses the **Prepared Transaction Pattern** for supervised Real-World Asset (RWA) actions on Robinhood Chain:

1. **AI Agent or User initiates an intent**:
   - Natural language via `POST /api/agent/propose` (e.g. *"Invest $250 into SpaceX stock"*), OR
   - Direct typed payload via `POST /api/intent/prepare`.
2. **Backend runs 5 deterministic security gates**:
   - Gate 1: **Asset Registry** (is asset approved and not paused?)
   - Gate 2: **Eligibility Preflight** (transfer verification & compliance)
   - Gate 3: **Policy Vault** (private spend limits, e.g. daily/single trade caps)
   - Gate 4: **Risk Engine** (slippage, non-zero amount, price impact)
   - Gate 5: **Approval Controller** (requires owner EOA signature)
3. **Backend returns `preparedTransaction`**:
   - A pre-encoded transaction `{ to, data, value, chainId, actionHash }`.
4. **User wallet pops up & signs**:
   - The frontend calls `sendTransaction({ to, data, value })` using standard wallet providers (MetaMask, Rainbow, Coinbase Wallet, Robinhood Wallet).
   - The user pays gas directly. **No bundlers, no UserOps, and no relayer fees required.**
5. **Receipt recorded**:
   - Frontend posts the resulting `txHash` to `POST /api/intent/receipt` for tamper-proof audit trails.

```
┌─────────────────┐       ┌──────────────────────┐       ┌────────────────────────┐
│  Frontend / UI  │ ────► │ Backend (5 Gates API)│ ────► │ User Wallet (Metamask) │
│ (TanStack/Wagmi)│ ◄──── │ (Prepared Tx Calldata│ ◄──── │ (Owner signs & pays gas│
└────────┬────────┘       └──────────────────────┘       └───────────┬────────────┘
         │                                                           │
         │                        txHash                             │
         └───────────────────────────────────────────────────────────┘
```

---

## 2. Supported Robinhood Chain Assets (Chain ID: 4663)

All assets below are canonical on Robinhood Chain Mainnet:

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
Translates user conversational input into a verified 5-gate prepared transaction in a single round-trip.

* **Endpoint**: `POST /api/agent/propose`
* **Request Body**:
```json
{
  "prompt": "Buy $250 worth of SpaceX stock on Robinhood Chain",
  "ownerAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "accountAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" // optional, defaults to owner
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
    "to": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
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
Call this right after the user signs and broadcasts the transaction in their wallet.

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
Allow users to create scoped session keys for low-risk actions (e.g. daily yield claims):

* **Prepare On-Chain Registration**: `POST /api/session/prepare-register`
```json
{
  "accountAddress": "0x7099...",
  "sessionKeyAddress": "0x90F7...",
  "validUntil": 1750000000,
  "dailyLimitUsdCents": 50000,
  "allowedTargets": ["0x8876789976decbfcbbbe364623c63652db8c0904"]
}
```
* **Store Active Session**: `POST /api/session/register`
* **List Account Sessions**: `GET /api/session/:accountAddress`
* **Instant One-Tap Revocation Calldata**: `POST /api/session/prepare-revoke`
* **Update DB Revocation**: `POST /api/session/revoke`

---

### 6. Account & Audit History
* **Register Account**: `POST /api/account/register` (`{ ownerAddress, accountAddress }`)
* **Account Stats & Status**: `GET /api/account/:address`
* **Full Audit History**: `GET /api/account/:address/history`

---

## 4. Frontend Code Integration Example (Wagmi / React)

```tsx
import React, { useState } from "react";
import { useAccount, useSendTransaction } from "wagmi";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://terrawallet-backend-latest.onrender.com";

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

      // 2. User wallet popup to sign and broadcast tx directly
      const hash = await sendTransactionAsync({
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value || 0),
      });

      // 3. Record receipt in audit history
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
          <p className="text-sm">{proposal.explanation}</p>
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

## 5. What Unblocks the Full Pipeline

1. **CORS**: Permissive CORS (`Access-Control-Allow-Origin: *`) is pre-configured on all routes in `backend/src/app.ts`, so browser fetches from `localhost:3000` or production Vercel domains will never fail preflights.
2. **Environment Variable for Frontend**:
   Set `VITE_BACKEND_URL=https://terrawallet-backend-latest.onrender.com` in your frontend environment.
3. **Smart Contracts Deployment (Optional)**:
   The backend works out of the box with counterfactual EOA/account execution. To register live factory and session manager contracts on Robinhood Chain Testnet or Mainnet, broadcast `contracts/script/Deploy.s.sol` using a funded deployer key.
