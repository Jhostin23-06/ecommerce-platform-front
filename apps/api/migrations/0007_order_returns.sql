CREATE TABLE IF NOT EXISTS order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'requested',
  reason varchar(500) NOT NULL,
  "adminNote" varchar(500) NULL,
  "requestedAmount" numeric(12, 2) NULL,
  "refundAmount" numeric(12, 2) NULL,
  currency varchar(3) NOT NULL DEFAULT 'PEN',
  "refundReference" varchar(255) NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_order_returns_order_created_desc
  ON order_returns ("orderId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS ix_order_returns_tenant_created_desc
  ON order_returns ("tenantId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS ix_order_returns_user_created_desc
  ON order_returns ("userId", "createdAt" DESC);
