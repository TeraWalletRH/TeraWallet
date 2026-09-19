CREATE TABLE IF NOT EXISTS private_bridge_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_symbol VARCHAR(16) NOT NULL CHECK (asset_symbol IN ('ETH', 'USDG')),
  decimals SMALLINT NOT NULL CHECK (decimals BETWEEN 0 AND 18),
  sender_address VARCHAR(42) NOT NULL,
  destination_chain_id INTEGER NOT NULL,
  destination_symbol VARCHAR(16) NOT NULL,
  destination_currency VARCHAR(66) NOT NULL,
  recipient_address VARCHAR(66) NOT NULL,
  amount NUMERIC(78,0) NOT NULL CHECK (amount > 0),
  expected_amount_out NUMERIC(78,0),
  min_amount_out NUMERIC(78,0),
  vault_address VARCHAR(42) NOT NULL,
  payout_address VARCHAR(42) NOT NULL,
  relay_request_id VARCHAR(66),
  status VARCHAR(32) NOT NULL DEFAULT 'awaiting_deposit' CHECK (status IN (
    'awaiting_deposit',
    'deposit_pending',
    'deposit_confirmed',
    'sweep_signed',
    'sweep_broadcast',
    'sweep_confirmed',
    'relay_signed',
    'relay_broadcast',
    'relay_confirmed',
    'relay_in_flight',
    'confirmed',
    'refunded',
    'expired',
    'failed'
  )),
  expires_at TIMESTAMPTZ NOT NULL,
  deposit_tx_hash VARCHAR(66) UNIQUE,
  sweep_tx_hash VARCHAR(66) UNIQUE,
  relay_deposit_tx_hash VARCHAR(66) UNIQUE,
  sweep_serialized_tx TEXT,
  relay_serialized_tx TEXT,
  failure_reason TEXT,
  relay_status_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_private_bridge_jobs_executor ON private_bridge_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_private_bridge_jobs_sender ON private_bridge_jobs(sender_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_private_bridge_jobs_relay_req ON private_bridge_jobs(relay_request_id);
