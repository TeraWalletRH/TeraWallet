-- Migration 017: Tiered Staking Lockups with APY Multipliers
ALTER TABLE staking_positions ADD COLUMN IF NOT EXISTS lock_until TIMESTAMPTZ;
ALTER TABLE staking_positions ADD COLUMN IF NOT EXISTS multiplier NUMERIC(5, 2) NOT NULL DEFAULT 1.0;
ALTER TABLE staking_positions ADD COLUMN IF NOT EXISTS lock_tier VARCHAR(16) NOT NULL DEFAULT 'flexible';

CREATE INDEX IF NOT EXISTS idx_staking_positions_lock_until ON staking_positions(lock_until);
