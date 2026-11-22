CREATE TABLE IF NOT EXISTS updateReleaseMonitor (
  repository VARCHAR(255) PRIMARY KEY,
  initializedAt BIGINT NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS updateOperations (
  operationId VARCHAR(64) PRIMARY KEY,
  initiatedBy BIGINT UNSIGNED,
  source VARCHAR(16) NOT NULL DEFAULT 'unknown',
  state VARCHAR(16) NOT NULL DEFAULT 'requested',
  startedAt BIGINT NOT NULL,
  updatedAt BIGINT NOT NULL,
  finishedAt BIGINT,
  fromVersion VARCHAR(128),
  targetVersion VARCHAR(128),
  rollback VARCHAR(16),
  diagnostic VARCHAR(255),
  INDEX idx_update_history (startedAt, operationId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS updateEvents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  eventKey CHAR(64) NOT NULL UNIQUE,
  kind VARCHAR(24) NOT NULL,
  createdAt BIGINT NOT NULL,
  version VARCHAR(128),
  operationId VARCHAR(64),
  rollback VARCHAR(16),
  releaseUrl VARCHAR(2048),
  releaseNotes MEDIUMTEXT,
  releaseSummary TEXT,
  publishedAt VARCHAR(40),
  INDEX idx_update_events_created (createdAt, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS updateEventReads (
  telegramId BIGINT UNSIGNED NOT NULL,
  eventId BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (telegramId, eventId),
  INDEX idx_update_reads_event (eventId),
  FOREIGN KEY (telegramId) REFERENCES adminAllowlist(telegramId) ON DELETE CASCADE,
  FOREIGN KEY (eventId) REFERENCES updateEvents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS updateTelegramSubscriptions (
  telegramId BIGINT UNSIGNED PRIMARY KEY,
  subscriptionKey VARCHAR(36) NOT NULL,
  FOREIGN KEY (telegramId) REFERENCES adminAllowlist(telegramId) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS updateTelegramOutbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  eventId BIGINT UNSIGNED NOT NULL,
  telegramId BIGINT UNSIGNED NOT NULL,
  subscriptionKey VARCHAR(36) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  availableAt BIGINT NOT NULL DEFAULT 0,
  claimToken VARCHAR(36),
  UNIQUE (eventId, telegramId),
  INDEX idx_update_telegram_due (status, availableAt, id),
  INDEX idx_update_telegram_recipient (telegramId, status),
  FOREIGN KEY (eventId) REFERENCES updateEvents(id) ON DELETE CASCADE,
  FOREIGN KEY (telegramId) REFERENCES adminAllowlist(telegramId) ON DELETE CASCADE
) ENGINE=InnoDB;
