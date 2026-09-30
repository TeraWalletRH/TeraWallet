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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- How many approvals a payment needs: a fixed number, or NULL for more than
  -- half of the signers. Signer changes keep it; only a threshold change,
  -- approved by the current signers, replaces it.
  approval_rule INTEGER
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
--
-- `nonce` is empty until the first approval: a proposal nobody has signed
-- holds no place in the Safe's strict order, so withdrawing it moves nothing.
-- A signer change also has no `data` until then — who comes before whom in
-- the Safe's owner list depends on the changes queued ahead of it, so it is
-- worked out when its place is known (`subject` is the signer it changes).
CREATE TABLE IF NOT EXISTS team_proposals (
  id BIGSERIAL PRIMARY KEY,
  safe_address VARCHAR(42) NOT NULL REFERENCES teams(safe_address) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL,
  subject VARCHAR(42),
  -- For a threshold change: the new rule (0 for more than half).
  rule INTEGER,
  to_address VARCHAR(42) NOT NULL,
  value NUMERIC(78, 0) NOT NULL,
  data TEXT,
  nonce NUMERIC(78, 0),
  safe_tx_hash CHAR(66),
  note VARCHAR(140) NOT NULL DEFAULT '',
  created_by VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  -- Set when whoever may cancel it asked for an on-chain cancellation, which
  -- keeps the approvals on everything queued after it.
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  -- Set when a signer change was rebuilt because the owner list moved.
  rebuilt_at TIMESTAMPTZ,
  executed_tx_hash CHAR(66),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_team_proposals_safe ON team_proposals(safe_address, status, nonce);

-- One vote per signer per proposal. An approval's `signature` is over the
-- proposal itself; a rejection's, once the proposal has a place in the queue,
-- is over the empty transaction at the same nonce that cancels it on-chain.
CREATE TABLE IF NOT EXISTS team_signatures (
  proposal_id BIGINT NOT NULL REFERENCES team_proposals(id) ON DELETE CASCADE,
  signer VARCHAR(42) NOT NULL,
  signature TEXT,
  rejected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (proposal_id, signer)
);
