ALTER TABLE orders
  ADD COLUMN contactDetails JSON NULL,
  ADD COLUMN requestKey VARCHAR(64) NULL,
  ADD UNIQUE INDEX orders_requestKey_unique (requestKey);
