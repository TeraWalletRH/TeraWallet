# TERA WALLET ADMIN DASHBOARD SPECIFICATION & IMPLEMENTATION PLAN

## Product Summary
Tera Wallet is a web3 digital wallet and decentralized financial platform running on the Robinhood Chain (EVM mainnet/testnet). Key capabilities derived from the codebase include:
- **Smart Accounts & Intent Execution**: User EVM accounts, session keys, and compliant intent execution (`accounts`, `session_keys`, `intents`).
- **Identity & Handles (`@tags`)**: User handle registration with lookalike collision prevention (`tags`).
- **Merchant Business Emails**: Verified merchant email payments (`business_emails`, `business_email_codes`).
- **Team Treasuries**: Safe multi-sig team treasuries and proposal approval queue (`teams`, `team_members`, `team_proposals`).
- **Merchant Payment Links**: One-time USDG merchant payment links (`payment_links`).
- **Privacy-Preserving Operations**: Private token transfers and cross-chain bridge jobs (`private_send_jobs`, `private_bridge_jobs`).
- **Custodial TERA Staking**: Epoch-based staking pool with automated and manual payout execution (`staking_epochs`, `staking_positions`, `staking_events`).

## Admin Responsibilities
The Admin Dashboard enables platform operators to:
1. **Oversee Platform Users & Accounts**: Inspect accounts, monitor session keys, revoke compromised session keys, view intent histories.
2. **Moderate Handle Register (`@tags`)**: Search registered tags, manually assign tags, release/delete inappropriate handles.
3. **Manage Merchant Business Emails**: Verify merchant emails, update business names, remove invalid registrations.
4. **Oversee Team Treasuries & Proposals**: Inspect team Safe treasuries, member roles, and pending/executed proposal queues.
5. **Monitor Merchant Payment Links**: Inspect payment link statuses, cancel open links, view payment transactions.
6. **Manage Private Send & Cross-Chain Bridge Operations**: Monitor job pipelines, inspect stuck/failed jobs, trigger retries or state overrides.
7. **Manage TERA Staking**: Create and configure staking epochs, control active/paused states, trigger and confirm payout broadcasts.
8. **View System Analytics & Audit Logs**: Track platform growth, active users, job volume, and audit log of all administrative actions.

---

## Module List

| Module | Entities Involved | Views & Features | Allowed Admin Actions | Permissions Required |
| :--- | :--- | :--- | :--- | :--- |
| **1. Dashboard Overview** | Aggregated stats across all models | Aggregated KPI cards, activity feed, job health charts | Refresh metrics, view trends | Admin |
| **2. Accounts & Sessions** | `accounts`, `session_keys`, `intents` | List with address search, chain filter, pagination. Detail view of sessions & intents | Revoke session key | Admin |
| **3. Tags / Handles** | `tags` | Search by tag or owner, sorting, pagination. Detail view | Register tag, release/delete tag | Admin |
| **4. Business Emails** | `business_emails`, `business_email_codes` | Search by email/business/owner, status filter, pagination | Force-verify email, revoke email | Admin |
| **5. Team Treasuries** | `teams`, `team_members`, `team_proposals` | Search by Safe address/name. Detail view of members & proposals | View proposal queue, inspect Safe status | Admin |
| **6. Merchant Payment Links** | `payment_links` | Search by merchant, status filter (open, paid, cancelled), pagination | Cancel open link, view paid transaction | Admin |
| **7. Private Send & Bridge Ops** | `private_send_jobs`, `private_bridge_jobs` | Search by sender/recipient/tx hash, status filter, pagination | Retry job, mark failed/expired | Admin |
| **8. TERA Staking** | `staking_epochs`, `staking_positions`, `staking_events` | Epoch list, position breakdown, payout queue | Create epoch, update status, broadcast/confirm payout | Admin |
| **9. Audit Trail** | `admin_audit_logs` | Chronological list of admin operations with details JSON, search | View audit logs | Admin |

---

## Backend Plan

### Schema & Migration Changes (`015_admin_dashboard.sql`)
1. `admin_sessions`: Persistent session tracking for logged-in admin users (`id`, `token_hash`, `expires_at`, `created_at`, `user_agent`, `ip`).
2. `admin_audit_logs`: Audit trail for destructive/modifying admin actions (`id`, `admin_token_hash`, `action`, `target_entity`, `target_id`, `details` JSONB, `created_at`).

### New API Endpoints

| Method | Path | Auth Required | Description | Touched Models |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/admin/auth/login` | None | Admin authentication using master secret | `admin_sessions` |
| `GET` | `/api/admin/auth/me` | Admin Session | Check admin session validity | `admin_sessions` |
| `POST` | `/api/admin/auth/logout` | Admin Session | Revoke current admin session | `admin_sessions` |
| `GET` | `/api/admin/stats` | Admin Session | Platform aggregated metrics & trends | All models |
| `GET` | `/api/admin/accounts` | Admin Session | Paginated accounts search & list | `accounts`, `session_keys` |
| `GET` | `/api/admin/accounts/:address` | Admin Session | Detailed account view with sessions & intents | `accounts`, `session_keys`, `intents` |
| `DELETE` | `/api/admin/sessions/:id` | Admin Session | Revoke a session key | `session_keys` |
| `GET` | `/api/admin/tags` | Admin Session | Paginated tags list with search | `tags` |
| `POST` | `/api/admin/tags` | Admin Session | Manually assign/claim a handle tag | `tags`, `admin_audit_logs` |
| `DELETE` | `/api/admin/tags/:tag` | Admin Session | Delete/release a handle tag | `tags`, `admin_audit_logs` |
| `GET` | `/api/admin/business-emails` | Admin Session | Paginated business emails list | `business_emails` |
| `POST` | `/api/admin/business-emails/verify` | Admin Session | Force-verify a business email | `business_emails`, `admin_audit_logs` |
| `DELETE` | `/api/admin/business-emails/:email` | Admin Session | Revoke/delete business email | `business_emails`, `admin_audit_logs` |
| `GET` | `/api/admin/teams` | Admin Session | List team treasuries | `teams`, `team_members` |
| `GET` | `/api/admin/teams/:safeAddress` | Admin Session | Team detail view (members & proposals) | `teams`, `team_members`, `team_proposals` |
| `GET` | `/api/admin/payment-links` | Admin Session | List merchant payment links | `payment_links` |
| `POST` | `/api/admin/payment-links/:id/cancel` | Admin Session | Cancel open payment link | `payment_links`, `admin_audit_logs` |
| `GET` | `/api/admin/private-jobs` | Admin Session | List private send & bridge jobs | `private_send_jobs`, `private_bridge_jobs` |
| `GET` | `/api/admin/private-jobs/:type/:id` | Admin Session | Job detail view with serialized TX | `private_send_jobs`, `private_bridge_jobs` |
| `POST` | `/api/admin/private-jobs/:type/:id/retry` | Admin Session | Trigger job retry or state update | `private_send_jobs`, `private_bridge_jobs`, `admin_audit_logs` |
| `GET` | `/api/admin/audit-logs` | Admin Session | View admin action audit trail | `admin_audit_logs` |

---

## Auth & Security Plan
- **Admin Authentication**: Validates passcode against `env.masterAdminKey` (`process.env.MASTER_ADMIN_KEY`). If valid, issues a crypto-random 256-bit token stored hashed in `admin_sessions`.
- **Token Delivery**: Returned in `Set-Cookie` (`tera_admin_session`, HttpOnly, SameSite=Strict) and JSON body (`token`), supporting both cookie and `Authorization: Bearer <token>` / `x-admin-token` headers.
- **Route & API Guards**: Backend middleware `requireAdminAuth` intercepts all `/api/admin/*` requests except `/api/admin/auth/login`. Unauthenticated requests receive HTTP 401.
- **Frontend Protection**: React TanStack Router guard redirects unauthenticated users to `/admin/login`.
- **Audit Trail**: Every modifying or destructive admin action writes an entry to `admin_audit_logs`.

---

## Frontend Plan
- **Location**: Built directly inside the existing web project using TanStack Router at path `/admin`.
- **Layout Shell**:
  - Protected sidebar with logo, navigation links for all admin modules, and collapse state.
  - Header bar with search, status indicator, admin user menu, and sign out button.
  - Main area rendering module content with Sonner toast notifications.
- **Route Structure**:
  - `/admin/login`: Admin Login view.
  - `/admin`: Root layout shell.
  - `/admin/dashboard`: Platform KPIs & Activity Overview.
  - `/admin/accounts`: Accounts & Session Keys table & detail modal.
  - `/admin/tags`: Handle Tags moderation table & creation/deletion dialogs.
  - `/admin/business-emails`: Business Emails management.
  - `/admin/teams`: Team Treasuries & Proposals inspector.
  - `/admin/payment-links`: Payment links management.
  - `/admin/private-jobs`: Private Send & Bridge job pipeline monitor.
  - `/admin/staking`: Staking epochs & payout execution interface.
  - `/admin/audit-logs`: Admin audit trail viewer.
- **Reusable UI Components**: Reusing `src/components/ui/` components (`Button`, `Card`, `Table`, `Dialog`, `Input`, `Select`, `Badge`, `Tabs`, `Pagination`, `Chart`, `Sonner`).

---

## Assumptions & Open Questions
1. `MASTER_ADMIN_KEY` environment variable supplies the admin master passcode (defaults to `"TeraWallet2026Secure"` for local development if unset).
2. DB pool fallbacks: When PostgreSQL is not connected (such as during test runs without `TEST_DB=true`), in-memory stores handle session and audit verification gracefully.

---

## Build Order
1. **Foundation (3a)**: Migration `015_admin_dashboard.sql`, `backend/src/admin-auth.ts`, `/api/admin/auth/*` routes, `requireAdminAuth` middleware, frontend `/admin/login` and `/admin` protected shell layout.
2. **Slice 1: Accounts & Sessions**: Backend endpoints + Frontend accounts & session keys view.
3. **Slice 2: Handle Tags Moderation**: Backend endpoints + Frontend tags management view.
4. **Slice 3: Business Emails Management**: Backend endpoints + Frontend business email verification view.
5. **Slice 4: Team Treasuries & Payment Links**: Backend endpoints + Frontend team inspector & payment link monitor.
6. **Slice 5: Private Send & Bridge Ops**: Backend endpoints + Frontend private job monitor & retry triggers.
7. **Slice 6: Staking & Audit Logs**: Backend endpoints + Frontend staking management & audit trail.
8. **Slice 7: Overview Dashboard**: Aggregated stats backend endpoint + Recharts KPI overview dashboard.
