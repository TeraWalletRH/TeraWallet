-- 002_schema_enhancements.sql
-- Relax foreign key constraints for standalone audit receipts and update defaults

ALTER TABLE audit_receipts ALTER COLUMN intent_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_receipts_action_hash ON audit_receipts(action_hash);
CREATE INDEX IF NOT EXISTS idx_audit_receipts_tx_hash ON audit_receipts(tx_hash);

-- Default chain_id to Robinhood Chain Testnet (46630)
ALTER TABLE accounts ALTER COLUMN chain_id SET DEFAULT 46630;

-- Additional metadata columns
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE intents ADD COLUMN IF NOT EXISTS prepared_tx JSONB;
