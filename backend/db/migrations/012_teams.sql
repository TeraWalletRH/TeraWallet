-- Team treasuries.
--
-- The treasury itself is a Safe on Robinhood Chain, and the Safe is the
-- authority on who can sign: nothing in these tables can move money. What is
-- kept here is what the chain does not hold — who else is on the team and in
-- which role, and the queue of payments waiting for enough signatures.

CREATE TABLE IF NOT EXISTS teams (
  safe_address VARCHAR(42) PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  name VARCHAR(40) NOT NULL DEFAULT '',
  created_by VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- `status` is 'invited' until the member signs to accept, then 'active'. A
-- signer role takes effect on-chain only once the Safe adds them as an owner.
CREATE TABLE IF NOT EXISTS team_members (
  safe_address VARCHAR(42) NOT NULL REFERENCES teams(safe_address) ON DELETE CASCADE,
  address VARCHAR(42) NOT NULL,
  role VARCHAR(12) NOT NULL,
  status VARCHAR(12) NOT NULL,
  invited_by VARCHAR(42),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  PRIMARY KEY (safe_address, address)
);
CREATE INDEX IF NOT EXISTS idx_team_members_address ON team_members(address);

-- A Safe transaction waiting for signatures. The fields are exactly what the
-- signers sign (see core/teams.js safeTxTypedData); `kind` and `note` are only
-- for reading the queue.
CREATE TABLE IF NOT EXISTS team_proposals (
  id BIGSERIAL PRIMARY KEY,
  safe_address VARCHAR(42) NOT NULL REFERENCES teams(safe_address) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  value NUMERIC(78, 0) NOT NULL,
  data TEXT NOT NULL,
  nonce NUMERIC(78, 0) NOT NULL,
  safe_tx_hash CHAR(66) NOT NULL,
  note VARCHAR(140) NOT NULL DEFAULT '',
  created_by VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  executed_tx_hash CHAR(66),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_team_proposals_safe ON team_proposals(safe_address, status, nonce);

CREATE TABLE IF NOT EXISTS team_signatures (
  proposal_id BIGINT NOT NULL REFERENCES team_proposals(id) ON DELETE CASCADE,
  signer VARCHAR(42) NOT NULL,
  signature TEXT,
  rejected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (proposal_id, signer)
);
