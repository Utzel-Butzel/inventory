ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "idempotency_key" uuid;
ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "request_hash" varchar(64);
ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "response" jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_idempotency_key_unique"
  ON "purchase_orders" ("idempotency_key");

ALTER TABLE "purchase_orders"
  DROP CONSTRAINT IF EXISTS "purchase_orders_idempotency_fields_together";
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_idempotency_fields_together" CHECK (
    ("idempotency_key" IS NULL AND "request_hash" IS NULL)
    OR ("idempotency_key" IS NOT NULL AND "request_hash" IS NOT NULL)
  );

ALTER TABLE "assembly_build_components"
  DROP CONSTRAINT IF EXISTS "assembly_build_components_component_resource_id_fkey";
ALTER TABLE "assembly_build_components"
  ADD CONSTRAINT "assembly_build_components_component_resource_id_fkey"
  FOREIGN KEY ("component_resource_id") REFERENCES "resources"("id")
  ON DELETE RESTRICT;

ALTER TABLE "assembly_build_components"
  DROP CONSTRAINT IF EXISTS "assembly_build_components_component_unit_id_fkey";
ALTER TABLE "assembly_build_components"
  ADD CONSTRAINT "assembly_build_components_component_unit_id_fkey"
  FOREIGN KEY ("component_unit_id") REFERENCES "stock_units"("id")
  ON DELETE RESTRICT;

COMMENT ON COLUMN "purchase_orders"."idempotency_key" IS
  'Optional for legacy rows; mandatory for all API-created purchase orders.';
