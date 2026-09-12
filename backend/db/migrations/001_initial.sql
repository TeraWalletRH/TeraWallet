-- Tera Wallet Initial Schema

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_address VARCHAR(42) NOT NULL,
  account_address VARCHAR(42) NOT NULL UNIQUE,
  chain_id INTEGER NOT NULL DEFAULT 1337,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner_address);

CREATE TABLE IF NOT EXISTS intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_address VARCHAR(42) NOT NULL REFERENCES accounts(account_address) ON DELETE CASCADE,
  agent_id VARCHAR(128) NOT NULL,
  intent_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'drafted',
  asset_address VARCHAR(42),
  route JSONB,
  raw_intent JSONB NOT NULL,
  action_hash VARCHAR(66) UNIQUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intents_account ON intents(account_address);
CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);

CREATE TABLE IF NOT EXISTS session_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_address VARCHAR(42) NOT NULL REFERENCES accounts(account_address) ON DELETE CASCADE,
  session_key_address VARCHAR(42) NOT NULL,
  scope JSONB NOT NULL,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON session_keys(account_address);

CREATE TABLE IF NOT EXISTS preflight_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  token_standard VARCHAR(32) NOT NULL DEFAULT 'ERC-3643',
  can_transfer BOOLEAN NOT NULL DEFAULT FALSE,
  compliance_details JSONB,
  policy_passed BOOLEAN NOT NULL DEFAULT FALSE,
  risk_passed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  action_hash VARCHAR(66) NOT NULL,
  tx_hash VARCHAR(66),
  recipient VARCHAR(128),
  proof_hash VARCHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
