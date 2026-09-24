-- Retire the bulk-only, parent-allocated variant model. Only disposable test
-- data used this model; no conversion into first-class resources is intended.
-- Existing resource quantities and their stock ledger remain unchanged.
-- Family variants continue to use resources + the protected variant_of edge.
ALTER TABLE "stock_movements"
  DROP COLUMN "variant_id",
  DROP COLUMN "variant_delta",
  DROP COLUMN "variant_balance_after";

ALTER TABLE "order_lines" DROP COLUMN "variant_id";
ALTER TABLE "woocommerce_order_line_syncs" DROP COLUMN "variant_id";

DROP TABLE "resource_variants";
