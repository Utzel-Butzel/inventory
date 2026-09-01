ALTER TABLE "purchase_order_lines"
  ADD COLUMN IF NOT EXISTS "unit_price_cents" integer,
  ADD COLUMN IF NOT EXISTS "price_currency" varchar(3);

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_unit_price_nonnegative"
  CHECK ("unit_price_cents" IS NULL OR "unit_price_cents" >= 0),
  ADD CONSTRAINT "purchase_order_lines_price_fields_together"
  CHECK (
    ("unit_price_cents" IS NULL AND "price_currency" IS NULL)
    OR
    ("unit_price_cents" IS NOT NULL AND "price_currency" ~ '^[A-Z]{3}$')
  );

ALTER TABLE "purchase_receipts"
  ADD COLUMN IF NOT EXISTS "total_price_cents" integer,
  ADD COLUMN IF NOT EXISTS "price_currency" varchar(3);

ALTER TABLE "purchase_receipts"
  ADD CONSTRAINT "purchase_receipts_total_price_nonnegative"
  CHECK ("total_price_cents" IS NULL OR "total_price_cents" >= 0),
  ADD CONSTRAINT "purchase_receipts_price_fields_together"
  CHECK (
    ("total_price_cents" IS NULL AND "price_currency" IS NULL)
    OR
    ("total_price_cents" IS NOT NULL AND "price_currency" ~ '^[A-Z]{3}$')
  );

ALTER TABLE "stock_units"
  ADD COLUMN IF NOT EXISTS "acquisition_cost_cents" integer,
  ADD COLUMN IF NOT EXISTS "cost_currency" varchar(3);

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_acquisition_cost_nonnegative"
  CHECK ("acquisition_cost_cents" IS NULL OR "acquisition_cost_cents" >= 0),
  ADD CONSTRAINT "stock_units_cost_fields_together"
  CHECK (
    ("acquisition_cost_cents" IS NULL AND "cost_currency" IS NULL)
    OR
    ("acquisition_cost_cents" IS NOT NULL AND "cost_currency" ~ '^[A-Z]{3}$')
  );

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "total_price_cents" integer,
  ADD COLUMN IF NOT EXISTS "price_currency" varchar(3),
  ADD COLUMN IF NOT EXISTS "cost_cents" integer,
  ADD COLUMN IF NOT EXISTS "cost_currency" varchar(3),
  ADD COLUMN IF NOT EXISTS "cost_estimated" boolean DEFAULT false NOT NULL;

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_cost_nonnegative"
  CHECK ("cost_cents" IS NULL OR "cost_cents" >= 0),
  ADD CONSTRAINT "stock_movements_price_fields_together"
  CHECK (
    ("total_price_cents" IS NULL AND "price_currency" IS NULL)
    OR
    ("total_price_cents" IS NOT NULL AND "price_currency" ~ '^[A-Z]{3}$')
  ),
  ADD CONSTRAINT "stock_movements_cost_fields_together"
  CHECK (
    ("cost_cents" IS NULL AND "cost_currency" IS NULL)
    OR
    ("cost_cents" IS NOT NULL AND "cost_currency" ~ '^[A-Z]{3}$')
  );

CREATE TABLE IF NOT EXISTS "stock_cost_layers" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "source_movement_id" uuid REFERENCES "stock_movements"("id") ON DELETE SET NULL,
  "unit_id" uuid REFERENCES "stock_units"("id") ON DELETE SET NULL,
  "initial_quantity" integer NOT NULL,
  "remaining_quantity" integer NOT NULL,
  "initial_cost_cents" integer,
  "remaining_cost_cents" integer,
  "currency" varchar(3) NOT NULL,
  "estimated" boolean DEFAULT false NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_cost_layers_organization_resource_fk"
    FOREIGN KEY ("organization_id", "resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "stock_cost_layers_initial_quantity_positive"
    CHECK ("initial_quantity" > 0),
  CONSTRAINT "stock_cost_layers_remaining_quantity_range"
    CHECK ("remaining_quantity" BETWEEN 0 AND "initial_quantity"),
  CONSTRAINT "stock_cost_layers_initial_cost_nonnegative"
    CHECK ("initial_cost_cents" IS NULL OR "initial_cost_cents" >= 0),
  CONSTRAINT "stock_cost_layers_remaining_cost_valid"
    CHECK (
      ("initial_cost_cents" IS NULL AND "remaining_cost_cents" IS NULL)
      OR
      (
        "initial_cost_cents" IS NOT NULL
        AND "remaining_cost_cents" BETWEEN 0 AND "initial_cost_cents"
      )
    ),
  CONSTRAINT "stock_cost_layers_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS "stock_cost_layers_fifo_idx"
  ON "stock_cost_layers" (
    "organization_id", "resource_id", "occurred_at", "created_at"
  );
CREATE INDEX IF NOT EXISTS "stock_cost_layers_source_movement_idx"
  ON "stock_cost_layers" ("source_movement_id");
CREATE INDEX IF NOT EXISTS "stock_cost_layers_unit_idx"
  ON "stock_cost_layers" ("unit_id");

CREATE TABLE IF NOT EXISTS "stock_cost_allocations" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "movement_id" uuid NOT NULL REFERENCES "stock_movements"("id") ON DELETE CASCADE,
  "layer_id" uuid NOT NULL REFERENCES "stock_cost_layers"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL,
  "cost_cents" integer,
  "currency" varchar(3) NOT NULL,
  "estimated" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_cost_allocations_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "stock_cost_allocations_cost_nonnegative"
    CHECK ("cost_cents" IS NULL OR "cost_cents" >= 0),
  CONSTRAINT "stock_cost_allocations_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_cost_allocations_movement_layer_unique"
  ON "stock_cost_allocations" ("movement_id", "layer_id");
CREATE INDEX IF NOT EXISTS "stock_cost_allocations_movement_idx"
  ON "stock_cost_allocations" ("movement_id");
CREATE INDEX IF NOT EXISTS "stock_cost_allocations_layer_idx"
  ON "stock_cost_allocations" ("layer_id");

ALTER TABLE "assembly_builds"
  ADD COLUMN IF NOT EXISTS "material_costs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "unpriced_component_quantity" integer DEFAULT 0 NOT NULL;

ALTER TABLE "assembly_builds"
  ADD CONSTRAINT "assembly_builds_unpriced_component_quantity_nonnegative"
  CHECK ("unpriced_component_quantity" >= 0),
  ADD CONSTRAINT "assembly_builds_material_costs_object"
  CHECK (jsonb_typeof("material_costs") = 'object');

ALTER TABLE "assembly_build_components"
  ADD COLUMN IF NOT EXISTS "cost_cents" integer,
  ADD COLUMN IF NOT EXISTS "cost_currency" varchar(3),
  ADD COLUMN IF NOT EXISTS "cost_estimated" boolean DEFAULT false NOT NULL;

ALTER TABLE "assembly_build_components"
  ADD CONSTRAINT "assembly_build_components_cost_nonnegative"
  CHECK ("cost_cents" IS NULL OR "cost_cents" >= 0),
  ADD CONSTRAINT "assembly_build_components_cost_fields_together"
  CHECK (
    ("cost_cents" IS NULL AND "cost_currency" IS NULL)
    OR
    ("cost_cents" IS NOT NULL AND "cost_currency" ~ '^[A-Z]{3}$')
  );

COMMENT ON TABLE "stock_cost_layers" IS
  'FIFO acquisition-cost layers for historically accurate inventory valuation.';
COMMENT ON COLUMN "stock_movements"."total_price_cents" IS
  'Signed user-entered transaction value; positive values are costs and negative values are revenue. For inbound stock, only nonnegative values are accepted and also establish acquisition cost.';
COMMENT ON COLUMN "stock_movements"."cost_cents" IS
  'Historical inventory cost added or consumed by this movement.';
