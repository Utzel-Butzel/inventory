ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "inventory_page_size" integer DEFAULT 50 NOT NULL;

ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_inventory_page_size_check";

ALTER TABLE "users"
  ADD CONSTRAINT "users_inventory_page_size_check"
  CHECK ("inventory_page_size" IN (50, 100, 200, 500));
