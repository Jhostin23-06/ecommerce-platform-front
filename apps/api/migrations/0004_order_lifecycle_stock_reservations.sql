ALTER TABLE products
  ADD COLUMN IF NOT EXISTS "reservedStock" int NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS "lifecycleStatus" varchar(30) NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  "previousStatus" varchar(30) NULL,
  "nextStatus" varchar(30) NOT NULL,
  source varchar(80) NOT NULL DEFAULT 'system',
  note varchar(500) NULL,
  "changedByUserId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_orders_lifecycle_status_created
  ON orders ("lifecycleStatus", "createdAt");

CREATE INDEX IF NOT EXISTS ix_order_status_history_order_id
  ON order_status_history ("orderId");

INSERT INTO order_status_history ("orderId", "previousStatus", "nextStatus", source, note, metadata)
SELECT
  o.id,
  NULL,
  CASE
    WHEN o.status = 'paid' THEN 'paid'
    WHEN o.status = 'cancelled' THEN 'cancelled'
    ELSE 'pending'
  END AS "nextStatus",
  'migration',
  'Initial lifecycle status backfill',
  jsonb_build_object('migration', '0004_order_lifecycle_stock_reservations.sql')
FROM orders o
WHERE NOT EXISTS (
  SELECT 1
  FROM order_status_history h
  WHERE h."orderId" = o.id
);
