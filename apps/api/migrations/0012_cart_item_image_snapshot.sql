ALTER TABLE cart_items
ADD COLUMN IF NOT EXISTS "productImageUrlSnapshot" varchar(2048);
