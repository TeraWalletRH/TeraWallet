# Security Policy

At Tera Wallet, security and user self-custody are fundamental design priorities. We appreciate the work of security researchers in identifying and responsibly disclosing vulnerabilities.

---

## 1. Scope

### In-Scope
- Backend API services, authentication, and routing logic under `/backend`.
- Gate pipeline implementation (Intent Gateway, Preflight verification, Policy Vault adapters).
- Smart account session key management and scoped authorization contracts.
- Frontend web application security (XSS, CSRF, insecure token storage).

### Out-of-Scope
- Third-party infrastructure providers (e.g., Render, Vercel, Supabase, Cloudflare) unless misconfiguration causes a direct vulnerability.
- Social engineering attacks targeting Tera Wallet contributors or users.
- Denial-of-service (DoS) attacks that do not cause data corruption or privilege escalation.

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability, please report it privately via email:

- **Security Contact**: `terawalletrh@outlook.com`
- **Subject Line**: `[SECURITY VULNERABILITY] <Brief Description>`

Please include in your report:
1. A description of the vulnerability and its potential impact.
2. Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
3. Any suggested remediations.

Do **not** submit security vulnerabilities through public GitHub issues or discussions.

---

## 3. Response Timeline

- **Acknowledgment**: Within 48 hours of receipt.
- **Initial Assessment**: Within 5 business days.
- **Remediation**: Critical severity vulnerabilities will be addressed within 7 business days where feasible.
- **Coordinated Disclosure**: We request that you refrain from public disclosure until an official fix is deployed and verified.

---

## 4. Reporter Expectations & Safe Harbor

If you make a good-faith effort to avoid privacy violations, data destruction, and service degradation during your research:
- We will not pursue legal action against you.
- We will work with you to understand and resolve the issue promptly.
- You will receive formal credit in the advisory release notes (unless anonymity is requested).

---

## 5. Project-Specific Attack Surfaces

Given Tera Wallet's supervised RWA agent architecture, specific high-priority attack vectors include:

1. **Prompt Injection & Gateway Deception**: Exploits designed to force the AI agent into outputting untrusted typed intents or misrepresenting transaction parameters.
2. **Session Key Scope Escalation**: Attempts to invoke smart contract functions outside granted bounds (e.g. unauthorized target contracts, elevated spending thresholds, expired session utilization).
3. **ERC-3643 Preflight Evasion**: Circumvention of deterministic compliance and transfer eligibility checks (`canTransfer` bypass).
4. **Signature Replay & Action Hash Tampering**: Tampering with action hashes, expiration bounds, or replaying approved owner signatures across multiple transactions.
5. **Policy Vault & ZK Proof Leakage**: Side-channel or direct leaks exposing private spending limits, confidential portfolio holdings, or undisclosed transaction receipts.

---

## 6. Deployed Contract Addresses

Contract deployment addresses on Robinhood Chain will be published here upon mainnet/testnet release.
