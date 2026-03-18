CREATE TABLE IF NOT EXISTS payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provider varchar(30) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'pending',
  "externalId" varchar(255) NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL DEFAULT 'PEN',
  reason varchar(255) NULL,
  "requestedByUserId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  "clientRequestId" varchar(100) NULL,
  metadata jsonb NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_payment_refunds_order_created_desc
  ON payment_refunds ("orderId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS ix_payment_refunds_tenant_created_desc
  ON payment_refunds ("tenantId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_refunds_provider_external
  ON payment_refunds (provider, "externalId");

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_refunds_order_client_request
  ON payment_refunds ("orderId", "clientRequestId");
