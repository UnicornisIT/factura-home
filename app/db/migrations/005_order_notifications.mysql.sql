CREATE TABLE IF NOT EXISTS orderTelegramSubscriptions (
  telegramId BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  subscriptionKey VARCHAR(36) NOT NULL,
  FOREIGN KEY (telegramId) REFERENCES adminAllowlist(telegramId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orderTelegramOutbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  orderId BIGINT UNSIGNED NOT NULL,
  telegramId BIGINT UNSIGNED NOT NULL,
  subscriptionKey VARCHAR(36) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  availableAt BIGINT NOT NULL DEFAULT 0,
  claimToken VARCHAR(36),
  UNIQUE (orderId, telegramId),
  INDEX idx_order_telegram_due (status, availableAt, id),
  FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
);
