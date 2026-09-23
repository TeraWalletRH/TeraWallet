# Tera Wallet

[![CI](https://github.com/notadeveloper7/terrawallet/actions/workflows/backend.yml/badge.svg)](https://github.com/notadeveloper7/terrawallet/actions/workflows/backend.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?logo=tailwindcss&logoColor=white)
![Robinhood Chain](https://img.shields.io/badge/Robinhood_Chain-Arbitrum_Orbit_L2-00C805)

Tera Wallet is a self-custodial wallet experience for supervised real-world-asset (RWA) workflows. An assistant can explain assets and prepare a typed proposal, while the owner reviews the checks and approves the exact transaction in their wallet. The product is built for Robinhood Chain (Arbitrum Orbit L2) and follows a private-by-default direction: _the agent can think; Tera Wallet checks; you approve._

**Explore the product:** [live wallet](https://terawallet.app/dashboard/) · [whitepaper](https://terawallet.app/whitepaper) · [roadmap](https://terawallet.app/roadmap/)

**Community:** [X](https://x.com/terawalletrh) · [Telegram](https://t.me/terawalletrh)

**Contract address:** `0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8`

语言：English · [简体中文](README.zh-CN.md)

**Android preview:** [Native wallet source and build guide](android/README.md) · [Public Android builds](https://github.com/TeraWalletRH/TeraWallet/actions/workflows/android.yml). Creates/imports a recovery phrase and signs on-device. Preview requires physical-device testing before production distribution.

---

## Core Capabilities

| Capability                     | RWA Agent Supervised Model                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Owner-supervised proposals** | Assistant chat turns a request into a structured transfer or workflow proposal; the owner reviews before signing.                                      |
| **Review gates**               | Asset, eligibility, policy, risk, and owner-approval states are shown before a wallet signature is requested.                                          |
| **Wallet connection**          | RainbowKit supports installed wallets and WalletConnect on Robinhood Chain.                                                                            |
| **Asset registry**             | Supported assets, decimals, contract addresses, eligibility, and action availability are visible in the dashboard.                                     |
| **Sessions and receipts**      | Agent sessions, revocation state, transaction status, and explorer links are available in the dashboard.                                               |
| **Privacy direction**          | The assistant receives only the message and wallet address needed for a proposal; private policy and selective-disclosure features are being expanded. |
| **Tags**                       | An owner can claim a name in Tera's register and be paid at `@astra` instead of an address. The resolved address is shown before anything is signed. Tera keeps the register, which is a weaker claim than the rest of this wallet makes and is stated as one. |

### Available now vs. planned

The current repository demonstrates the supervised proposal workflow and its backend integration. ERC-4337 smart-account execution, production ERC-3643 adapters, zero-knowledge policy proofs, and cryptographic selective-disclosure receipts remain protocol work planned for later phases.

---

## How It Works: The Gate Pipeline

Every action initiated by a user or agent passes through a fixed chain of deterministic gates. Each gate can only **narrow** what can happen; the agent's natural language cannot widen execution scope:

```
User Request
    │
    ▼
Agent drafts typed intent (`createIntent`)
    │
    ├──► 1. Asset Registry:       Is this asset & venue route supported?
    ├──► 2. Eligibility Preflight: Do ERC-3643 compliance & issuer rules pass?
    ├──► 3. Private Policy Vault: Is the proposal within private spending limits?
    ├──► 4. Risk Engine:          Are price impact, slippage, and bounds safe?
    └──► 5. Approval Controller:  Does the owner need to sign?
    │
    ▼
Tera Wallet Smart Account validates on-chain & executes (ERC-4337 UserOp)
```

---

## Ecosystem Roles

| Participant             | Role                                                | Reward / Outcome                                     |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| **RWA Owner**           | Supervises agent intents within private limits      | Automation without surrendering keys or privacy      |
| **Agent Developer**     | Builds against typed intent schema (`createIntent`) | Bounded, safe surface — zero liability for execution |
| **Issuer / Provider**   | Supplies preflight attestation facts                | Compliant distribution to self-custodial accounts    |
| **Verifier / Attestor** | Validates registry state and action receipts        | Protocol trust attestation                           |
| **$TERA Staker**        | Secures registry governance & fee distribution      | Protocol fee share                                   |

---

## Backend API Endpoints

The backend exposes an Express service running under Bun:

| Method | Endpoint                        | Description                                          |
| ------ | ------------------------------- | ---------------------------------------------------- |
| `GET`  | `/health`                       | Service health status, server timestamp, and version |
| `GET`  | `/api/assets`                   | Asset registry and supported actions                 |
| `POST` | `/api/assets/preflight`         | Asset and eligibility preflight checks               |
| `POST` | `/api/agent/chat`               | Assistant response for an owner message              |
| `POST` | `/api/agent/propose`            | Prepare a structured owner-review proposal           |
| `POST` | `/api/intent/prepare`           | Prepare intent checks and transaction data           |
| `GET`  | `/api/intent/:actionHash`       | Retrieve an intent status                            |
| `POST` | `/api/intent/receipt`           | Reconcile a submitted transaction receipt            |
| `POST` | `/api/account/register`         | Register or initialize an account record             |
| `GET`  | `/api/account/:address`         | Retrieve account state                               |
| `GET`  | `/api/account/:address/history` | Retrieve account history                             |
| `POST` | `/api/session/prepare-register` | Prepare a scoped session registration                |
| `POST` | `/api/session/register`         | Register a scoped session                            |
| `GET`  | `/api/session/:accountAddress`  | List account sessions                                |
| `POST` | `/api/session/prepare-revoke`   | Prepare session revocation                           |
| `POST` | `/api/session/revoke`           | Revoke a scoped session                              |
| `GET`  | `/api/tags/config`              | Whether the tag register is on, and who keeps it     |
| `POST` | `/api/tags/resolve`             | Address a tag names                                  |
| `GET`  | `/api/tags/by-address/:address` | Tag an address holds                                 |
| `GET`  | `/api/tags/available/:tag`      | Whether a name can still be claimed                  |
| `GET`  | `/api/tags/search`              | Prefix search over the register                      |
| `POST` | `/api/tags/claim`               | Bind a name to the wallet that signed for it         |
| `POST` | `/api/tags/release`             | Give a name up                                       |
| `GET`  | `/api/mobile/android/manifest`  | Published Android version, floor and APK digest (`?channel=preview\|production`, default preview) |

### Tags

`@astra` is a row in Tera's register, not a name on chain. Claiming one is a
`personal_sign` over the exact text in `public/tera/core/tags.js`, which the service
rebuilds from the tag and address it is about to write and refuses if it cannot
recover the signer. That stops a claim being forged in transit.

It does **not** make the register trustworthy in the way the rest of this wallet is.
A balance is read from the chain; a transfer is rebuilt from calldata before signing;
a receipt is checked against a published hash. A tag is none of those — if this
database is wrong, a wallet is told an address it cannot verify. Every response
carries `source: "service"` and the claim screens say so, because an owner should
know which of their answers are Tera's word and which are not. The address is still
what a transfer is built from, and both surfaces print it before anything is signed.

Names that read alike collide: `@astr0` cannot be claimed while `@astro` exists. The
fold is in `tags.js` and the `skeleton` column is `UNIQUE`, so the database enforces
it rather than a check somebody could forget. One tag per address — claiming a second
releases the first in the same transaction.

A tag names one address **on Robinhood Chain**. It is not offered as a bridge
destination, because the destination chain's address is a different account. Tags are
public: anyone can read which address one points at.

Backend: `TAGS_ENABLED=true` and a database. No contract, no gas, no relayer key. Both
wallets ask `/api/tags/config` on load and hide every tag control until it says yes.

There is no tag contract in this repository. An on-chain register would remove the
trust described above; moving to one later would not change the API shape the clients
already use.

---

## Repository Structure

```
terrawallet/
├── .github/workflows/     # CI/CD pipelines (Backend build, test, release, deploy)
├── backend/               # Bun + Express + PostgreSQL backend service
│   ├── db/migrations/     # Raw SQL transactional schema migrations
│   ├── src/
│   │   ├── db/            # Connection pool & migration runner
│   │   ├── routes/        # Express route handlers
│   │   ├── app.ts         # App configuration & middleware
│   │   └── index.ts       # Server bootstrap
│   ├── tests/             # Backend test suites (bun test + supertest)
│   ├── Dockerfile         # Production Bun Alpine container
│   └── tsconfig.json
├── contracts/             # Smart contracts workspace (Foundry)
├── public/                # Static assets, branding, and images
├── src/                   # TanStack React + Tailwind frontend application
│   ├── components/        # Reusable UI component library (shadcn/Radix)
│   ├── routes/            # TanStack Router route definitions
│   └── styles.css         # Tailwind styles & theme variables
├── technical-docs/        # Architectural and technical documentation
├── AGENTS.md              # Agent interaction rules and operational constraints
├── CONTRIBUTING.md        # Contribution guide & code style standards
├── LICENSE                # MIT License
├── README.md              # Project documentation
└── SECURITY.md            # Security policy and disclosure instructions
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- [Node.js](https://nodejs.org) (v20+ recommended for tooling)
- [PostgreSQL](https://www.postgresql.org/) (local or cloud instance)

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/notadeveloper7/terrawallet.git
   cd terrawallet
   ```

2. **Frontend setup:**

   ```bash
   bun install
   cp .env.example .env
   bun run dev
   ```

3. **Backend setup:**

   ```bash
   cd backend
   bun install
   cp .env.example .env
   # Configure DATABASE_URL in backend/.env
   bun run dev
   ```

4. **Run tests:**
   ```bash
   cd backend
   bun run test
   ```

---

## Roadmap

- [x] **Phase A — RWA readiness**: Asset registry, viewer UI, issuer-constraint presentation, and demo RWA environments.
- [x] **Phase B — Supervised proposal layer**: Assistant chat, typed proposal preparation, review gates, wallet approval UI, and receipts.
- [x] **Phase C — Integration foundation**: Backend intent, asset, account, and session routes with frontend preflight and receipt handling.
- [ ] **Phase D — Production execution**: ERC-4337 smart-account UserOp execution, non-replayable hashes, and owner authorization on-chain.
- [ ] **Phase E — Scoped automation**: Bounded session keys for low-risk actions with production registration and revocation enforcement.
- [ ] **Phase F — Private policy proofs**: Local/private policy evaluation, zero-knowledge compliance proofs, and selective-disclosure receipts.

---

## Tech Stack

- **Frontend**: TanStack Start / React 19, Vite, Tailwind CSS v4, Radix UI primitives.
- **Backend**: TypeScript, Bun, Express, PostgreSQL (`pg`).
- **Chain & Protocol**: Robinhood Chain (Arbitrum Orbit L2), ERC-4337 Account Abstraction, ERC-3643 (T-REX).
- **Deployment**: Render (Backend), Vercel (Frontend).
- **CI/CD**: GitHub Actions + GitHub Container Registry (GHCR).

## NFT gallery

The dashboard and Android app find ERC-721 and ERC-1155 tokens from Robinhood Chain transfer logs and verify current ownership with the token contracts. Send uses the wallet's normal review and signing flow. NFT metadata and pictures load directly from collection servers or the public Pinata IPFS gateway. Those third-party hosts can see your network address and which token was requested; Pinata may rate-limit image requests, and some web metadata hosts block browser reads.

Open the [NFT gallery](https://terawallet.app/dashboard/nfts/).
