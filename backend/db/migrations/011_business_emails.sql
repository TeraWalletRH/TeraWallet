-- Business emails: an email a Tera Business wallet can be paid at.
--
-- Like `tags`, this table is the fact rather than a cache of one, so every
-- answer the API gives says `source: "service"`. A row exists only after the
-- wallet signed for the email and the inbox returned the code sent to it.
--
-- One email per wallet and one wallet per email. Proving an inbox again moves
-- the email to the wallet that proved it, because the inbox is the authority
-- on who the email belongs to.

CREATE TABLE IF NOT EXISTS business_emails (
  email VARCHAR(254) PRIMARY KEY,
  owner_address VARCHAR(42) NOT NULL UNIQUE,
  business_name VARCHAR(60) NOT NULL DEFAULT '',
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Codes waiting to be typed back. Only a keyed hash of the code is kept, so a
-- read of this table does not hand anyone a working code.
CREATE TABLE IF NOT EXISTS business_email_codes (
  email VARCHAR(254) NOT NULL,
  owner_address VARCHAR(42) NOT NULL,
  business_name VARCHAR(60) NOT NULL DEFAULT '',
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (email, owner_address)
);

CREATE INDEX IF NOT EXISTS idx_business_email_codes_created ON business_email_codes(email, created_at);
