# Tera Wallet

[![CI](https://github.com/notadeveloper7/terrawallet/actions/workflows/backend.yml/badge.svg)](https://github.com/notadeveloper7/terrawallet/actions/workflows/backend.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?logo=tailwindcss&logoColor=white)
![Robinhood Chain](https://img.shields.io/badge/Robinhood_Chain-Arbitrum_Orbit_L2-00C805)

Tera Wallet is a self-custodial smart wallet that lets an AI agent *propose* real-world-asset (RWA) actions while the wallet — not the agent — decides what is permitted, and the owner keeps final authority. Built on Robinhood Chain (Arbitrum Orbit L2), it combines ERC-4337 account abstraction, ERC-3643 compliance preflight verification, and zero-knowledge policy proofs into a private-by-default execution environment: *the agent can think; Tera Wallet enforces; you approve.*

---

## Core Capabilities

| Capability | RWA Agent Supervised Model |
|---|---|
| **Self-Custodial Smart Account** | User-owned ERC-4337 smart wallet for supervised agent intent delegation. |
| **Eligibility Preflight Gate** | Deterministic ERC-3643 (`canTransfer`) and issuer constraint checks before signatures or gas spend. |
| **Private Policy Vault** | Private spending, risk, and asset limits that the agent and external venues cannot inspect. |
| **Zero-Knowledge Policy Proofs** | Cryptographic verification that an action conforms to policy without revealing threshold values. |
| **Scoped Session Keys** | Granular, revocable, low-risk execution sessions (e.g. yield claims) enforced on-chain. |
| **Selective Disclosure Receipts** | Granular proof and receipt emission without exposing full portfolio or transaction history. |

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

| Participant | Role | Reward / Outcome |
|---|---|---|
| **RWA Owner** | Supervises agent intents within private limits | Automation without surrendering keys or privacy |
| **Agent Developer** | Builds against typed intent schema (`createIntent`) | Bounded, safe surface — zero liability for execution |
| **Issuer / Provider** | Supplies preflight attestation facts | Compliant distribution to self-custodial accounts |
| **Verifier / Attestor** | Validates registry state and action receipts | Protocol trust attestation |
| **$TERA Staker** | Secures registry governance & fee distribution | Protocol fee share |

---

## Backend API Endpoints

The backend exposes an Express service running under Bun:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health status, server timestamp, and version |

*(Additional agent intent gateway, preflight proxy, and session key management endpoints to be configured in subsequent phases).*

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

- [x] **Phase A — RWA Readiness**: Asset registry schema, viewer UI, issuer constraint presentation, mock RWA environments.
- [ ] **Phase B — Agent Proposal Layer**: Intent Gateway and chat interface; agent drafts typed intents without direct execution rights.
- [ ] **Phase C — Eligibility & Route Preflight**: ERC-3643 `canTransfer` preflight adapters, deterministic route validation, simulation.
- [ ] **Phase D — Owner-Approved Execution**: ERC-4337 smart account UserOp execution; non-replayable hashes and owner authorization.
- [ ] **Phase E — Scoped Agent Automation**: Bounded session keys for low-risk actions (e.g. yield claiming).
- [ ] **Phase F — Private Policy Proofs**: Zero-knowledge proofs of policy compliance, scheduled post-audit.

---

## Tech Stack

- **Frontend**: TanStack Start / React 19, Vite, Tailwind CSS v4, Radix UI primitives.
- **Backend**: TypeScript, Bun, Express, PostgreSQL (`pg`).
- **Chain & Protocol**: Robinhood Chain (Arbitrum Orbit L2), ERC-4337 Account Abstraction, ERC-3643 (T-REX).
- **Deployment**: Render (Backend), Vercel (Frontend).
- **CI/CD**: GitHub Actions + GitHub Container Registry (GHCR).
