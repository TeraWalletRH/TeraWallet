-- Price history for symbols whose price comes from an on-chain swap quote
-- rather than a real market feed (every RWA/equity token, plus TERA).
--
-- There is no external historical-price API for a tokenized equity proxy
-- backed by a Robinhood Chain AMM pool, so the only history that can exist
-- is what this server has itself observed over time. Persisting it here,
-- rather than keeping it only in process memory, is what lets a token's
-- detail-page chart survive a redeploy instead of losing its whole history
-- every time this service restarts.
CREATE TABLE IF NOT EXISTS price_snapshots (
  symbol VARCHAR(16) NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS price_snapshots_symbol_time ON price_snapshots (symbol, recorded_at);
