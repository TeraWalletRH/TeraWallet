-- Merchant payment links: a request for an exact USDG amount, paid once.
--
-- A row is opened only by a signature from the merchant's wallet, and marked
-- paid only after the service read the paying transaction from the chain. The
-- unique paid_tx stops one payment settling two links.

CREATE TABLE IF NOT EXISTS payment_links (
  id VARCHAR(16) PRIMARY KEY,
  merchant VARCHAR(42) NOT NULL,
  amount NUMERIC(78, 0) NOT NULL,
  note VARCHAR(140) NOT NULL DEFAULT '',
  status VARCHAR(12) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_tx VARCHAR(66) UNIQUE,
  payer VARCHAR(42),
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_links_merchant ON payment_links(merchant, created_at DESC);
