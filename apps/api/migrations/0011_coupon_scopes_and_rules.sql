DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coupons_scope_enum') THEN
    CREATE TYPE coupons_scope_enum AS ENUM ('order', 'volume', 'bundle');
  END IF;
END
$$;

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS scope coupons_scope_enum NOT NULL DEFAULT 'order';

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS rules jsonb NULL;
