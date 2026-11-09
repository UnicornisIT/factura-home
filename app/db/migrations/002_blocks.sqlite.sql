CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  position INTEGER NOT NULL,
  isVisible INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL DEFAULT '{}',
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_blocks_position ON blocks(position);
