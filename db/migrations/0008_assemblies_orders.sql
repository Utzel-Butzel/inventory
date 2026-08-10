CREATE TABLE IF NOT EXISTS "bom_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assembly_resource_id" uuid NOT NULL
    REFERENCES "resources"("id") ON DELETE CASCADE,
  "component_resource_id" uuid NOT NULL
    REFERENCES "resources"("id") ON DELETE RESTRICT,
  "quantity_per_assembly" integer NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bom_lines_quantity_per_assembly_positive"
    CHECK ("quantity_per_assembly" > 0),
  CONSTRAINT "bom_lines_position_nonnegative" CHECK ("position" >= 0),
  CONSTRAINT "bom_lines_distinct_resources"
    CHECK ("assembly_resource_id" <> "component_resource_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bom_lines_assembly_component_unique"
  ON "bom_lines" ("assembly_resource_id", "component_resource_id");
CREATE INDEX IF NOT EXISTS "bom_lines_assembly_resource_id_idx"
  ON "bom_lines" ("assembly_resource_id");
CREATE INDEX IF NOT EXISTS "bom_lines_component_resource_id_idx"
  ON "bom_lines" ("component_resource_id");

CREATE TABLE IF NOT EXISTS "assembly_builds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assembly_resource_id" uuid NOT NULL
    REFERENCES "resources"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "location" varchar(240),
  "note" text DEFAULT '' NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "response" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assembly_builds_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "assembly_builds_idempotency_key_unique"
  ON "assembly_builds" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "assembly_builds_assembly_resource_id_idx"
  ON "assembly_builds" ("assembly_resource_id");
CREATE INDEX IF NOT EXISTS "assembly_builds_assembly_occurred_idx"
  ON "assembly_builds" ("assembly_resource_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reference" varchar(160),
  "supplier" varchar(240) NOT NULL,
  "status" varchar(32) DEFAULT 'draft' NOT NULL,
  "ordered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expected_at" timestamp with time zone,
  "note" text DEFAULT '' NOT NULL,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_orders_status_check" CHECK (
    "status" IN (
      'draft', 'ordered', 'partially-received', 'received', 'cancelled'
    )
  )
);

CREATE INDEX IF NOT EXISTS "purchase_orders_status_idx"
  ON "purchase_orders" ("status");
CREATE INDEX IF NOT EXISTS "purchase_orders_expected_at_idx"
  ON "purchase_orders" ("expected_at");

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_order_id" uuid NOT NULL
    REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "resource_id" uuid NOT NULL
    REFERENCES "resources"("id") ON DELETE RESTRICT,
  "ordered_quantity" integer NOT NULL,
  "received_quantity" integer DEFAULT 0 NOT NULL,
  "expected_at" timestamp with time zone,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_order_lines_ordered_quantity_positive"
    CHECK ("ordered_quantity" > 0),
  CONSTRAINT "purchase_order_lines_received_quantity_nonnegative"
    CHECK ("received_quantity" >= 0),
  CONSTRAINT "purchase_order_lines_received_not_above_ordered"
    CHECK ("received_quantity" <= "ordered_quantity")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_lines_order_resource_unique"
  ON "purchase_order_lines" ("purchase_order_id", "resource_id");
CREATE INDEX IF NOT EXISTS "purchase_order_lines_purchase_order_id_idx"
  ON "purchase_order_lines" ("purchase_order_id");
CREATE INDEX IF NOT EXISTS "purchase_order_lines_resource_id_idx"
  ON "purchase_order_lines" ("resource_id");

CREATE TABLE IF NOT EXISTS "purchase_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_order_line_id" uuid NOT NULL
    REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "location" varchar(240),
  "note" text DEFAULT '' NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "response" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_receipts_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_receipts_idempotency_key_unique"
  ON "purchase_receipts" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "purchase_receipts_purchase_order_line_id_idx"
  ON "purchase_receipts" ("purchase_order_line_id");
CREATE INDEX IF NOT EXISTS "purchase_receipts_line_occurred_idx"
  ON "purchase_receipts" ("purchase_order_line_id", "occurred_at");

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "assembly_build_id" uuid
    REFERENCES "assembly_builds"("id") ON DELETE SET NULL;
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "purchase_receipt_id" uuid
    REFERENCES "purchase_receipts"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "stock_movements_assembly_build_id_idx"
  ON "stock_movements" ("assembly_build_id");
CREATE INDEX IF NOT EXISTS "stock_movements_purchase_receipt_id_idx"
  ON "stock_movements" ("purchase_receipt_id");

CREATE TABLE IF NOT EXISTS "assembly_build_components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "build_id" uuid NOT NULL
    REFERENCES "assembly_builds"("id") ON DELETE CASCADE,
  "component_resource_id" uuid
    REFERENCES "resources"("id") ON DELETE SET NULL,
  "component_name" varchar(240) NOT NULL,
  "component_sku" varchar(80),
  "quantity_per_assembly" integer NOT NULL,
  "quantity_consumed" integer NOT NULL,
  "component_unit_id" uuid
    REFERENCES "stock_units"("id") ON DELETE SET NULL,
  "output_unit_id" uuid
    REFERENCES "stock_units"("id") ON DELETE SET NULL,
  "stock_movement_id" uuid
    REFERENCES "stock_movements"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assembly_build_components_quantity_per_assembly_positive"
    CHECK ("quantity_per_assembly" > 0),
  CONSTRAINT "assembly_build_components_quantity_consumed_positive"
    CHECK ("quantity_consumed" > 0)
);

CREATE INDEX IF NOT EXISTS "assembly_build_components_build_id_idx"
  ON "assembly_build_components" ("build_id");
CREATE INDEX IF NOT EXISTS "assembly_build_components_component_resource_id_idx"
  ON "assembly_build_components" ("component_resource_id");
CREATE INDEX IF NOT EXISTS "assembly_build_components_component_unit_id_idx"
  ON "assembly_build_components" ("component_unit_id");
CREATE INDEX IF NOT EXISTS "assembly_build_components_output_unit_id_idx"
  ON "assembly_build_components" ("output_unit_id");
CREATE INDEX IF NOT EXISTS "assembly_build_components_stock_movement_id_idx"
  ON "assembly_build_components" ("stock_movement_id");

COMMENT ON TABLE "assembly_build_components" IS
  'Immutable component snapshots and stock links for completed assembly builds.';
COMMENT ON TABLE "purchase_receipts" IS
  'Idempotent partial-receipt events that link ordered and physical stock.';
