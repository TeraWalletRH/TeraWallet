CREATE TABLE IF NOT EXISTS private_send_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_address VARCHAR(42),
  asset_symbol VARCHAR(16) NOT NULL CHECK (asset_symbol IN ('ETH','TERA')),
  decimals SMALLINT NOT NULL CHECK (decimals BETWEEN 0 AND 18),
  sender_address VARCHAR(42) NOT NULL,
  recipient_address VARCHAR(42) NOT NULL,
  amount NUMERIC(78,0) NOT NULL CHECK (amount > 0),
  intake_address VARCHAR(42) NOT NULL,
  payout_address VARCHAR(42) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'awaiting_deposit' CHECK (status IN ('awaiting_deposit','deposit_pending','deposit_confirmed','sweep_signed','sweep_broadcast','sweep_confirmed','payout_signed','payout_broadcast','confirmed','expired','failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  deposit_tx_hash VARCHAR(66) UNIQUE,
  sweep_tx_hash VARCHAR(66) UNIQUE,
  payout_tx_hash VARCHAR(66) UNIQUE,
  sweep_serialized_tx TEXT,
  payout_serialized_tx TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_private_send_jobs_executor ON private_send_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_private_send_jobs_sender ON private_send_jobs(sender_address, created_at DESC);
