-- Fixed-term custodial TERA staking locks (30, 45, 90 days) with strict maturity locks.
CREATE TABLE IF NOT EXISTS staking_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  epoch_id UUID REFERENCES staking_epochs(id) ON DELETE SET NULL,
  term_days INTEGER NOT NULL CHECK (term_days IN (30, 45, 90)),
  apy_bps INTEGER NOT NULL,
  principal_amount NUMERIC(78, 0) NOT NULL CHECK (principal_amount > 0),
  reward_amount NUMERIC(78, 0) NOT NULL CHECK (reward_amount >= 0),
  starts_at TIMESTAMPTZ NOT NULL,
  unlocks_at TIMESTAMPTZ NOT NULL CHECK (unlocks_at > starts_at),
  deposit_tx_hash VARCHAR(66) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'matured', 'claimed')),
  claimed_at TIMESTAMPTZ,
  payout_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staking_locks_wallet ON staking_locks(wallet_address, status);
CREATE INDEX IF NOT EXISTS idx_staking_locks_unlocks ON staking_locks(unlocks_at, status);

-- Allow staking_payouts to link directly to a fixed staking lock
ALTER TABLE staking_payouts ALTER COLUMN epoch_id DROP NOT NULL;
ALTER TABLE staking_payouts ADD COLUMN IF NOT EXISTS lock_id UUID REFERENCES staking_locks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_staking_payouts_lock ON staking_payouts(lock_id);

-- Allow staking_events to link to locks
ALTER TABLE staking_events ALTER COLUMN epoch_id DROP NOT NULL;
ALTER TABLE staking_events ADD COLUMN IF NOT EXISTS lock_id UUID REFERENCES staking_locks(id) ON DELETE SET NULL;
