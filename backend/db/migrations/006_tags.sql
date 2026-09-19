-- Tag index.
--
-- This is a cache of TagRegistry on Robinhood Chain, not the record itself.
-- Nothing here is authoritative: a resolve answers from the chain, and this
-- table exists so that searching and listing do not need one eth_call per row.
-- If the two disagree, the chain is right and this is stale.

CREATE TABLE IF NOT EXISTS tags (
  tag VARCHAR(20) PRIMARY KEY,
  skeleton VARCHAR(20) NOT NULL UNIQUE,
  owner_address VARCHAR(42) NOT NULL UNIQUE,
  block_number BIGINT NOT NULL,
  log_index INTEGER NOT NULL,
  tx_hash VARCHAR(66) NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prefix search for the claim screen's "is this taken" and the recipient
-- field's autocomplete.
CREATE INDEX IF NOT EXISTS idx_tags_prefix ON tags(tag text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_tags_owner ON tags(owner_address);

-- How far the indexer has read. One row, by construction.
CREATE TABLE IF NOT EXISTS tag_index_cursor (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tag_index_cursor (id, last_block) VALUES (TRUE, 0) ON CONFLICT (id) DO NOTHING;

-- A relayed claim costs the relayer gas, so it is rate limited per wallet. The
-- row is the evidence for that limit and is pruned by the service.
CREATE TABLE IF NOT EXISTS tag_claim_relays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_address VARCHAR(42) NOT NULL,
  tag VARCHAR(20) NOT NULL,
  tx_hash VARCHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_claim_relays_owner ON tag_claim_relays(owner_address, created_at DESC);
