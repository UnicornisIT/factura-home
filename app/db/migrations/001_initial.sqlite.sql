CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  coverImage TEXT,
  sortOrder INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collectionId INTEGER NOT NULL REFERENCES collections(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  material TEXT DEFAULT '',
  price INTEGER NOT NULL,
  image TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  sortOrder INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  comment TEXT,
  items TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  createdAt INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS siteContent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shopName TEXT NOT NULL DEFAULT 'Глиняная мастерская',
  heroTitle TEXT NOT NULL DEFAULT 'Декор для дома ручной работы',
  heroText TEXT NOT NULL,
  aboutTitle TEXT NOT NULL DEFAULT 'О мастерской',
  aboutText TEXT NOT NULL,
  aboutImage TEXT,
  deliveryTitle TEXT NOT NULL DEFAULT 'Доставка по всей России',
  deliveryText TEXT NOT NULL,
  footerCta TEXT NOT NULL DEFAULT 'Для заказа напишите в удобный для вас мессенджер',
  telegram TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  email TEXT DEFAULT '',
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS adminAllowlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegramId INTEGER NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin',
  addedAt INTEGER NOT NULL DEFAULT (unixepoch()),
  addedByTelegramId INTEGER,
  isActive INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS adminSessions (
 tokenHash VARCHAR(64) PRIMARY KEY,
 telegramId BIGINT NOT NULL,
 payload TEXT NOT NULL,
 expiresAt BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS telegramAuthReplay (hash VARCHAR(64) PRIMARY KEY, expiresAt BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS adminAuditLog (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 createdAt BIGINT NOT NULL,
 actorTelegramId BIGINT NOT NULL,
 targetTelegramId BIGINT,
 action VARCHAR(128) NOT NULL,
 roleBefore VARCHAR(32), roleAfter VARCHAR(32), outcome VARCHAR(32) NOT NULL
);
CREATE TABLE IF NOT EXISTS apiRateLimits (bucket VARCHAR(64) PRIMARY KEY, hits INTEGER NOT NULL, expiresAt BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_products_collection ON products(collectionId);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_sessions_telegram ON adminSessions(telegramId);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON adminSessions(expiresAt);


CREATE INDEX IF NOT EXISTS idx_replay_expiry ON telegramAuthReplay(expiresAt);
CREATE INDEX IF NOT EXISTS idx_rate_expiry ON apiRateLimits(expiresAt);
