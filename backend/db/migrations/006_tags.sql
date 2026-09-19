-- Tag register.
--
-- This table is the fact, not a cache of one: there is no on-chain registry
-- behind it. Resolving a tag means trusting this row, which is why every
-- answer the API gives says `source: "service"` and why a claim carries the
-- owner's signature.
--
-- `skeleton` is the lookalike-collision key from public/tera/core/tags.js
-- (underscores dropped, confusable digits folded to letters). It is UNIQUE so
-- the database refuses `@astr0` while `@astro` exists, rather than relying on
-- a check somebody could forget to call.

CREATE TABLE IF NOT EXISTS tags (
  tag VARCHAR(20) PRIMARY KEY,
  skeleton VARCHAR(20) NOT NULL UNIQUE,
  owner_address VARCHAR(42) NOT NULL UNIQUE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prefix search for the claim screen and the recipient field.
CREATE INDEX IF NOT EXISTS idx_tags_prefix ON tags(tag text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_tags_owner ON tags(owner_address);
