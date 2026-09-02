ALTER TABLE "stock_settings"
  ADD COLUMN IF NOT EXISTS "purchase_unit_name" varchar(80),
  ADD COLUMN IF NOT EXISTS "purchase_unit_factor" integer;

ALTER TABLE "stock_settings"
  ADD CONSTRAINT "stock_settings_purchase_unit_pair"
  CHECK (
    ("purchase_unit_name" IS NULL AND "purchase_unit_factor" IS NULL)
    OR
    ("purchase_unit_name" IS NOT NULL AND "purchase_unit_factor" > 0)
  );

ALTER TABLE "purchase_order_lines"
  ADD COLUMN IF NOT EXISTS "purchase_unit_name" varchar(80),
  ADD COLUMN IF NOT EXISTS "purchase_unit_factor" integer DEFAULT 1 NOT NULL;

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_purchase_unit_valid"
  CHECK (
    ("purchase_unit_name" IS NULL AND "purchase_unit_factor" = 1)
    OR
    ("purchase_unit_name" IS NOT NULL AND "purchase_unit_factor" > 0)
  );

COMMENT ON COLUMN "stock_settings"."purchase_unit_factor" IS
  'Number of base stock units represented by one purchase or packaging unit.';
COMMENT ON COLUMN "purchase_order_lines"."purchase_unit_factor" IS
  'Snapshot of the base-unit conversion used when the order line was created.';
