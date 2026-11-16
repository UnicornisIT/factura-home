ALTER TABLE orders ADD COLUMN contactDetails TEXT;
ALTER TABLE orders ADD COLUMN requestKey TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_requestKey_unique ON orders (requestKey);
