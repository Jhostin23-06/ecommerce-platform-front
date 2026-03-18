CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId" uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  slug varchar(160) NOT NULL,
  sku varchar(80),
  price numeric(12, 2) NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  "reservedStock" integer NOT NULL DEFAULT 0,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_variants_product_slug UNIQUE ("productId", slug)
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants("productId");
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id_active ON product_variants("productId", "isActive");

CREATE TABLE IF NOT EXISTS product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "productId" uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title varchar(160),
  comment text,
  "isVerifiedPurchase" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_reviews_product_user UNIQUE ("productId", "userId")
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON product_reviews("productId");
CREATE INDEX IF NOT EXISTS idx_product_reviews_tenant_id ON product_reviews("tenantId");

CREATE TABLE IF NOT EXISTS wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "productId" uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_wishlist_items_tenant_user_product UNIQUE ("tenantId", "userId", "productId")
);

CREATE INDEX IF NOT EXISTS idx_wishlist_items_user_id ON wishlist_items("userId");
CREATE INDEX IF NOT EXISTS idx_wishlist_items_tenant_user_id ON wishlist_items("tenantId", "userId");

ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS "productVariantId" uuid REFERENCES product_variants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_cart_items_product_variant_id ON cart_items("productVariantId");

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS "productVariantId" uuid REFERENCES product_variants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_order_items_product_variant_id ON order_items("productVariantId");
