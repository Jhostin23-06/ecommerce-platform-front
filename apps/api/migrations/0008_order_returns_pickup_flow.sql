ALTER TABLE order_returns
  ADD COLUMN IF NOT EXISTS "pickupCourierName" varchar(120) NULL,
  ADD COLUMN IF NOT EXISTS "pickupCourierPhone" varchar(40) NULL,
  ADD COLUMN IF NOT EXISTS "pickupScheduledAt" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "pickupCompletedAt" timestamptz NULL;

CREATE INDEX IF NOT EXISTS ix_order_returns_tenant_status_created_desc
  ON order_returns ("tenantId", status, "createdAt" DESC);
