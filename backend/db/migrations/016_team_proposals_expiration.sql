-- Migration 016: Support proposal auto-expiration windows for Safe team treasuries
ALTER TABLE team_proposals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_team_proposals_expires ON team_proposals(safe_address, status, expires_at);
