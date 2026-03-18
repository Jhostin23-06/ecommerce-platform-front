ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS "billingDetails" jsonb NULL;

CREATE TABLE IF NOT EXISTS tenant_billing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider varchar(30) NOT NULL DEFAULT 'demo',
  environment varchar(20) NOT NULL DEFAULT 'demo',
  "isActive" boolean NOT NULL DEFAULT false,
  "issuerRuc" varchar(11) NULL,
  "issuerBusinessName" varchar(160) NULL,
  "issuerAddress" varchar(220) NULL,
  "invoiceSeries" varchar(10) NOT NULL DEFAULT 'F001',
  "receiptSeries" varchar(10) NOT NULL DEFAULT 'B001',
  "creditNoteSeries" varchar(10) NOT NULL DEFAULT 'FC01',
  "apiBaseUrl" varchar(255) NULL,
  "apiToken" varchar(255) NULL,
  "extraConfig" jsonb NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_billing_settings_tenant_id
  ON tenant_billing_settings ("tenantId");

CREATE TABLE IF NOT EXISTS billing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "orderId" uuid NULL REFERENCES orders(id) ON DELETE SET NULL,
  "refundId" uuid NULL REFERENCES payment_refunds(id) ON DELETE SET NULL,
  provider varchar(30) NOT NULL,
  environment varchar(20) NOT NULL,
  kind varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'issued',
  series varchar(10) NOT NULL,
  number int NOT NULL,
  "documentNumber" varchar(30) NOT NULL,
  "externalId" varchar(255) NULL,
  "issueDate" timestamptz NOT NULL DEFAULT NOW(),
  currency varchar(3) NOT NULL DEFAULT 'PEN',
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  "taxTotal" numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  "customerName" varchar(160) NOT NULL,
  "customerDocumentType" varchar(20) NOT NULL,
  "customerDocumentNumber" varchar(40) NOT NULL,
  "requestPayload" jsonb NULL,
  "providerResponse" jsonb NULL,
  "errorMessage" varchar(500) NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_billing_documents_tenant_created_desc
  ON billing_documents ("tenantId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS ix_billing_documents_order_created_desc
  ON billing_documents ("orderId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_documents_refund_id
  ON billing_documents ("refundId")
  WHERE "refundId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_documents_order_single_sale_doc
  ON billing_documents ("orderId")
  WHERE "orderId" IS NOT NULL
    AND kind IN ('receipt', 'invoice');
