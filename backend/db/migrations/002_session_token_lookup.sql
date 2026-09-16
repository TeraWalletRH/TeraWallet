-- Opaque service session tokens are stored as SHA-256 hashes in scope.
-- Keep authorization lookups fast without persisting the token itself.
CREATE INDEX IF NOT EXISTS idx_session_keys_token_hash
  ON session_keys ((scope ->> 'tokenHash'))
  WHERE scope ->> 'tokenHash' IS NOT NULL;
