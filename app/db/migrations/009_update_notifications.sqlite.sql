CREATE TABLE IF NOT EXISTS updateReleaseMonitor (
  repository TEXT PRIMARY KEY,
  initializedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS updateOperations (
  operationId TEXT PRIMARY KEY,
  initiatedBy INTEGER,
  source TEXT NOT NULL DEFAULT 'unknown',
  state TEXT NOT NULL DEFAULT 'requested',
  startedAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  finishedAt INTEGER,
  fromVersion TEXT,
  targetVersion TEXT,
  rollback TEXT,
  diagnostic TEXT
);

CREATE INDEX IF NOT EXISTS idx_update_history ON updateOperations (startedAt, operationId);

CREATE TABLE IF NOT EXISTS updateEvents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventKey TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  version TEXT,
  operationId TEXT,
  rollback TEXT,
  releaseUrl TEXT,
  releaseNotes TEXT,
  releaseSummary TEXT,
  publishedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_update_events_created ON updateEvents (createdAt, id);

CREATE TABLE IF NOT EXISTS updateEventReads (
  telegramId INTEGER NOT NULL REFERENCES adminAllowlist(telegramId) ON DELETE CASCADE,
  eventId INTEGER NOT NULL REFERENCES updateEvents(id) ON DELETE CASCADE,
  PRIMARY KEY (telegramId, eventId)
);

CREATE INDEX IF NOT EXISTS idx_update_reads_event ON updateEventReads (eventId);

CREATE TABLE IF NOT EXISTS updateTelegramSubscriptions (
  telegramId INTEGER PRIMARY KEY REFERENCES adminAllowlist(telegramId) ON DELETE CASCADE,
  subscriptionKey TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS updateTelegramOutbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId INTEGER NOT NULL REFERENCES updateEvents(id) ON DELETE CASCADE,
  telegramId INTEGER NOT NULL REFERENCES adminAllowlist(telegramId) ON DELETE CASCADE,
  subscriptionKey TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  availableAt INTEGER NOT NULL DEFAULT 0,
  claimToken TEXT,
  UNIQUE (eventId, telegramId)
);

CREATE INDEX IF NOT EXISTS idx_update_telegram_due ON updateTelegramOutbox (status, availableAt, id);
CREATE INDEX IF NOT EXISTS idx_update_telegram_recipient ON updateTelegramOutbox (telegramId, status);
