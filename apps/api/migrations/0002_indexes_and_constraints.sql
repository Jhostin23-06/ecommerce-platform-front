CREATE UNIQUE INDEX IF NOT EXISTS ux_carts_active_tenant_user
  ON carts ("tenantId", "userId")
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_items_cart_product
  ON cart_items ("cartId", "productId");

CREATE INDEX IF NOT EXISTS ix_categories_tenant_active
  ON categories ("tenantId", "isActive");

CREATE INDEX IF NOT EXISTS ix_products_tenant_active
  ON products ("tenantId", "isActive");

CREATE INDEX IF NOT EXISTS ix_products_tenant_category
  ON products ("tenantId", "categoryId");

CREATE INDEX IF NOT EXISTS ix_coupons_tenant_code
  ON coupons ("tenantId", code);

CREATE INDEX IF NOT EXISTS ix_delivery_zones_tenant_active_sort
  ON delivery_zones ("tenantId", "isActive", "sortOrder");

CREATE INDEX IF NOT EXISTS ix_pickup_points_tenant_active_sort
  ON pickup_points ("tenantId", "isActive", "sortOrder");

CREATE INDEX IF NOT EXISTS ix_orders_user_created_desc
  ON orders ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS ix_orders_tenant_created_desc
  ON orders ("tenantId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS ix_orders_status_created
  ON orders (status, "createdAt");

CREATE INDEX IF NOT EXISTS ix_payment_transactions_order_created_desc
  ON payment_transactions ("orderId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS ix_payment_transactions_external
  ON payment_transactions ("externalId");
