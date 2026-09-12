# Contributing to Tera Wallet

Thank you for your interest in contributing to Tera Wallet. This document outlines our development workflows, code standards, and contribution guidelines.

---

## 1. What Contributions Are Wanted Right Now

We are actively accepting contributions for:
- **ERC-3643 Preflight Adapters**: Mock and live contract verification adapters for `canTransfer`, compliance registry queries, and issuer claim validations.
- **Intent Gateway Interfaces**: Typed intent schema definitions, serialization, validation (Zod schemas), and hashing algorithms.
- **Frontend Components**: Dashboard screens, asset detail cards, gate status pipelines, and session management UI.
- **Unit and Integration Tests**: Expanded test suites for backend route handlers, migration scripts, and preflight calculations.

### What is Out of Scope
- Unbounded or raw private-key handling by LLM agents.
- Autonomous trade execution bypassing the Approval Controller or session limits.
- Proprietary or unverified custodial wallets.

---

## 2. Development Setup

### Prerequisites
- [Bun](https://bun.sh) (v1.1+)
- [Node.js](https://nodejs.org) (v20+)
- [Git](https://git-scm.com/)

### Clone and Install
```bash
# Clone repository
git clone https://github.com/notadeveloper7/terrawallet.git
cd terrawallet

# Install frontend dependencies
bun install

# Install backend dependencies
cd backend
bun install
cp .env.example .env
cd ..
```

---

## 3. Contribution Workflow

1. **Fork and Branch**: Fork the repository and create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Make Changes**: Follow the project code formatting and architectural guidelines.
3. **Validate**:
   ```bash
   # Run backend typecheck and tests
   cd backend
   bun run check
   bun test
   ```
4. **Commit**: Use concise, imperative commit messages (e.g., `add erc3643 preflight check adapter`).
5. **Open Pull Request**: Push to your fork and submit a PR to `main`.

---

## 4. Pull Request Guidelines

- **Single Concern**: Each PR should address one bug or feature.
- **Tests Included**: Any change affecting preflight logic, migrations, or routes must include unit tests.
- **Clean CI**: Ensure all GitHub Actions checks pass before requesting review.
- **No Co-author trailers / AI watermarks**: Keep commit histories clean and legible.

---

## 5. Commit Message Convention

Use imperative, present-tense messages:
- `add session key revocation endpoint` (Good)
- `added session key revocation endpoint` (Avoid)
- `fixes preflight status serialization bug` (Avoid)

---

## 6. Bug Reporting Format

When submitting an issue, please use the following template:

- **Context**: What intent, asset, or route were you testing?
- **Steps to Reproduce**: Detailed commands, inputs, or API payloads.
- **Expected Behavior**: What should have happened according to protocol rules.
- **Actual Behavior**: Error messages, status codes, or stack traces.
- **Environment**: OS, Bun version, browser.

---

## 7. Security Vulnerabilities

Please do **not** report security vulnerabilities via public GitHub issues. Refer to [SECURITY.md](SECURITY.md) for instructions on confidential disclosure.
