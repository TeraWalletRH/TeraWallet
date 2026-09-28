-- Brings the team tables to the shape the queue needs, whichever version of
-- 012_teams.sql a database ran. 012 was revised after a first deploy — lazy
-- nonces, signer changes worked out at their place, the approval rule — and a
-- database that had already applied the first version never saw those
-- columns, so saving a team failed. Every statement here is a no-op where the
-- revised 012 already ran.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS approval_rule INTEGER;

ALTER TABLE team_proposals ADD COLUMN IF NOT EXISTS subject VARCHAR(42);
ALTER TABLE team_proposals ADD COLUMN IF NOT EXISTS rule INTEGER;
ALTER TABLE team_proposals ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE team_proposals ADD COLUMN IF NOT EXISTS rebuilt_at TIMESTAMPTZ;
ALTER TABLE team_proposals ALTER COLUMN data DROP NOT NULL;
ALTER TABLE team_proposals ALTER COLUMN nonce DROP NOT NULL;
ALTER TABLE team_proposals ALTER COLUMN safe_tx_hash DROP NOT NULL;
