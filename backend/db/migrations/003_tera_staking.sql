-- Custodial TERA staking ledger. Token quantities are base-unit NUMERIC values
-- stored as text-compatible numerics so they never pass through floating point.
CREATE TABLE IF NOT EXISTS staking_epochs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address VARCHAR(42) NOT NULL,
  pool_address VARCHAR(42) NOT NULL,
  funded_amount NUMERIC(78, 0) NOT NULL CHECK (funded_amount >= 0),
  funding_tx_hash VARCHAR(66) NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  reward_rate_per_second NUMERIC(78, 0) NOT NULL CHECK (reward_rate_per_second >= 0),
  reward_per_token NUMERIC(78, 0) NOT NULL DEFAULT 0,
  total_active_stake NUMERIC(78, 0) NOT NULL DEFAULT 0,
  distributed_rewards NUMERIC(78, 0) NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staking_positions (
  epoch_id UUID NOT NULL REFERENCES staking_epochs(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) NOT NULL,
  active_stake NUMERIC(78, 0) NOT NULL DEFAULT 0,
  accrued_rewards NUMERIC(78, 0) NOT NULL DEFAULT 0,
  reward_debt NUMERIC(78, 0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (epoch_id, wallet_address)
);

CREATE TABLE IF NOT EXISTS staking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epoch_id UUID NOT NULL REFERENCES staking_epochs(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42),
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('stake', 'claim_requested', 'unstake_requested', 'payout_attempt', 'payout_confirmed', 'payout_failed', 'reconciled')),
  amount NUMERIC(78, 0),
  tx_hash VARCHAR(66),
  idempotency_key VARCHAR(128) UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staking_epochs_status ON staking_epochs(status);
CREATE INDEX IF NOT EXISTS idx_staking_positions_wallet ON staking_positions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_staking_events_epoch ON staking_events(epoch_id, created_at DESC);
