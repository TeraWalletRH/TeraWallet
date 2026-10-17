-- Migration 018: Account & Wallet Deletions with 30-Day Recovery Period

CREATE TABLE IF NOT EXISTS account_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_address VARCHAR(42) NOT NULL,
  owner_address VARCHAR(42),
  scope VARCHAR(32) NOT NULL DEFAULT 'full',
  wallet_index INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_deletion',
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  recovered_at TIMESTAMPTZ,
  purged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_account_deletions_address ON account_deletions(account_address);
CREATE INDEX IF NOT EXISTS idx_account_deletions_status ON account_deletions(status);
CREATE INDEX IF NOT EXISTS idx_account_deletions_expires ON account_deletions(expires_at);
