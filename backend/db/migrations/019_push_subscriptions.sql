-- Push notifications: the devices that asked to hear about a wallet while
-- Tera is closed.
--
-- A row is opened only by a signature from the wallet (core/push.js), and
-- holds nothing beyond what a push needs: the wallet's public address, the
-- push address and keys the browser gave, and whether amounts may show.
-- Turning push off deletes the row; a push service saying the device is gone
-- deletes it too.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT NOT NULL,
  address VARCHAR(42) NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  detail VARCHAR(8) NOT NULL DEFAULT 'amounts',
  language VARCHAR(4) NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ,
  PRIMARY KEY (endpoint, address)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_address ON push_subscriptions(address);
