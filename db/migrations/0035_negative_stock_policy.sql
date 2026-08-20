-- Negative stock is an organization-level policy. Cross-table organization
-- settings cannot be expressed with PostgreSQL CHECK constraints, so the
-- application validates these balances under the same transaction/row locks
-- used by each stock workflow.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "allow_negative_stock" boolean DEFAULT false NOT NULL;

ALTER TABLE "resources"
  DROP CONSTRAINT IF EXISTS "resources_quantity_nonnegative";
ALTER TABLE "resource_variants"
  DROP CONSTRAINT IF EXISTS "resource_variants_quantity_nonnegative";
ALTER TABLE "stock_location_balances"
  DROP CONSTRAINT IF EXISTS "stock_location_balances_nonnegative";
ALTER TABLE "stock_movements"
  DROP CONSTRAINT IF EXISTS "stock_movements_balance_nonnegative",
  DROP CONSTRAINT IF EXISTS "stock_movements_variant_balance_nonnegative",
  DROP CONSTRAINT IF EXISTS "stock_movements_from_location_balance_nonnegative",
  DROP CONSTRAINT IF EXISTS "stock_movements_to_location_balance_nonnegative";
