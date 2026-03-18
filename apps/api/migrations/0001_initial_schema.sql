CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'users_role_enum') THEN
    CREATE TYPE users_role_enum AS ENUM (
      'platform_superadmin',
      'tenant_admin',
      'catalog_manager',
      'order_manager',
      'support',
      'customer'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'carts_status_enum') THEN
    CREATE TYPE carts_status_enum AS ENUM ('active', 'ordered', 'abandoned');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coupons_type_enum') THEN
    CREATE TYPE coupons_type_enum AS ENUM ('percentage', 'fixed');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'orders_status_enum') THEN
    CREATE TYPE orders_status_enum AS ENUM ('pending_payment', 'paid', 'cancelled');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'orders_fulfillmenttype_enum') THEN
    CREATE TYPE orders_fulfillmenttype_enum AS ENUM ('delivery', 'pickup');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'orders_fulfillmentstatus_enum') THEN
    CREATE TYPE orders_fulfillmentstatus_enum AS ENUM (
      'pending',
      'preparing',
      'ready_for_dispatch',
      'on_the_way',
      'ready_for_pickup',
      'completed',
      'failed'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  slug varchar(80) NOT NULL UNIQUE,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(160) NOT NULL UNIQUE,
  "fullName" varchar(120) NOT NULL,
  "passwordHash" varchar NOT NULL,
  role users_role_enum NOT NULL DEFAULT 'customer',
  "tenantId" uuid NULL REFERENCES tenants(id) ON DELETE SET NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "refreshTokenHash" varchar NULL,
  "refreshTokenExpiresAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  slug varchar(120) NOT NULL,
  description text NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE ("tenantId", slug)
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "categoryId" uuid NULL REFERENCES categories(id) ON DELETE SET NULL,
  name varchar(160) NOT NULL,
  slug varchar(160) NOT NULL,
  description text NULL,
  price numeric(12, 2) NOT NULL DEFAULT 0,
  stock int NOT NULL DEFAULT 0,
  sku varchar(80) NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE ("tenantId", slug)
);

CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId" uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url varchar(1024) NOT NULL,
  "altText" varchar(200) NULL,
  "sortOrder" int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status carts_status_enum NOT NULL DEFAULT 'active',
  currency varchar(3) NOT NULL DEFAULT 'PEN',
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  "discountTotal" numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cartId" uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  "productId" uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  "productNameSnapshot" varchar(160) NOT NULL,
  "skuSnapshot" varchar(80) NULL,
  "unitPrice" numeric(12, 2) NOT NULL DEFAULT 0,
  quantity int NOT NULL DEFAULT 1,
  "lineTotal" numeric(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code varchar(50) NOT NULL,
  type coupons_type_enum NOT NULL,
  value numeric(12, 2) NOT NULL,
  "usageCount" int NOT NULL DEFAULT 0,
  "maxUsage" int NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "startsAt" timestamptz NULL,
  "endsAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE ("tenantId", code)
);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  districts jsonb NOT NULL DEFAULT '[]'::jsonb,
  fee numeric(12, 2) NOT NULL DEFAULT 0,
  "minOrderAmount" numeric(12, 2) NOT NULL DEFAULT 0,
  "freeShippingFrom" numeric(12, 2) NULL,
  "etaMinutes" int NOT NULL DEFAULT 180,
  "sortOrder" int NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pickup_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  address varchar(220) NULL,
  windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sortOrder" int NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status orders_status_enum NOT NULL DEFAULT 'pending_payment',
  "paymentStatus" varchar(30) NOT NULL DEFAULT 'unpaid',
  "paymentProvider" varchar(30) NULL,
  "paymentReference" varchar(255) NULL,
  "couponCode" varchar(50) NULL,
  "fulfillmentType" orders_fulfillmenttype_enum NOT NULL DEFAULT 'delivery',
  "fulfillmentStatus" orders_fulfillmentstatus_enum NOT NULL DEFAULT 'pending',
  "deliveryAddress" jsonb NULL,
  "pickupDetails" jsonb NULL,
  "deliveryZoneId" uuid NULL,
  "deliveryZoneName" varchar(120) NULL,
  "deliveryWindow" varchar(120) NULL,
  "assignedCourierName" varchar(120) NULL,
  "assignedCourierPhone" varchar(40) NULL,
  "fulfillmentNotes" varchar(500) NULL,
  "shippingFee" numeric(12, 2) NOT NULL DEFAULT 0,
  "estimatedFulfillmentAt" timestamptz NULL,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  "discountTotal" numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL DEFAULT 'PEN',
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  "productId" uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  "productName" varchar(160) NOT NULL,
  sku varchar(80) NULL,
  "unitPrice" numeric(12, 2) NOT NULL DEFAULT 0,
  quantity int NOT NULL DEFAULT 1,
  "lineTotal" numeric(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provider varchar(30) NOT NULL,
  status varchar(50) NOT NULL,
  "eventType" varchar(100) NULL,
  "externalId" varchar(255) NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL DEFAULT 'PEN',
  metadata jsonb NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);
