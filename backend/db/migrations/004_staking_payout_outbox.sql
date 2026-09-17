CREATE TABLE IF NOT EXISTS staking_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epoch_id UUID NOT NULL REFERENCES staking_epochs(id) ON DELETE RESTRICT,
  wallet_address VARCHAR(42) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('claim','unstake')),
  principal_amount NUMERIC(78,0) NOT NULL DEFAULT 0,
  reward_amount NUMERIC(78,0) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','signed','broadcast','confirmed','failed')),
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  tx_hash VARCHAR(66) UNIQUE,
  serialized_tx TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_staking_payouts_pending ON staking_payouts(status, created_at) WHERE status IN ('requested','signed','broadcast');
