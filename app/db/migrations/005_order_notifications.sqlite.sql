CREATE TABLE IF NOT EXISTS orderTelegramSubscriptions (
  telegramId INTEGER PRIMARY KEY REFERENCES adminAllowlist(telegramId) ON DELETE CASCADE,
  subscriptionKey TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orderTelegramOutbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  telegramId INTEGER NOT NULL,
  subscriptionKey TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  availableAt INTEGER NOT NULL DEFAULT 0,
  claimToken TEXT,
  UNIQUE (orderId, telegramId)
);

CREATE INDEX IF NOT EXISTS idx_order_telegram_due ON orderTelegramOutbox (status, availableAt, id);
