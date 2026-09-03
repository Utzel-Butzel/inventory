-- Bind individual serialized stock units to sales and loan order lines.
-- The link owns the business lifecycle; stock_units keeps the physical state
-- and stock_movements remains the immutable inventory ledger.

CREATE UNIQUE INDEX "order_lines_organization_id_id_unique"
  ON "order_lines" ("organization_id", "id");

CREATE TABLE "order_line_units" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_line_id" uuid NOT NULL,
  "stock_unit_id" uuid NOT NULL,
  "status" varchar(16) DEFAULT 'reserved' NOT NULL,
  "reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "fulfilled_at" timestamp with time zone,
  "returned_at" timestamp with time zone,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_line_units_organization_order_line_fk"
    FOREIGN KEY ("organization_id", "order_line_id")
    REFERENCES "order_lines" ("organization_id", "id")
    ON DELETE CASCADE,
  CONSTRAINT "order_line_units_organization_stock_unit_fk"
    FOREIGN KEY ("organization_id", "stock_unit_id")
    REFERENCES "stock_units" ("organization_id", "id")
    ON DELETE RESTRICT,
  CONSTRAINT "order_line_units_line_unit_unique"
    UNIQUE ("organization_id", "order_line_id", "stock_unit_id"),
  CONSTRAINT "order_line_units_status_check"
    CHECK ("status" IN ('reserved', 'fulfilled', 'returned')),
  CONSTRAINT "order_line_units_timestamps_check"
    CHECK (
      ("status" = 'reserved' AND "fulfilled_at" IS NULL AND "returned_at" IS NULL)
      OR
      ("status" = 'fulfilled' AND "fulfilled_at" IS NOT NULL AND "returned_at" IS NULL)
      OR
      ("status" = 'returned' AND "fulfilled_at" IS NOT NULL AND "returned_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "order_line_units_active_stock_unit_unique"
  ON "order_line_units" ("organization_id", "stock_unit_id")
  WHERE "status" IN ('reserved', 'fulfilled');
CREATE INDEX "order_line_units_line_status_idx"
  ON "order_line_units" ("organization_id", "order_line_id", "status");

ALTER TABLE "orders" DROP CONSTRAINT "orders_type_status_check";
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_type_status_check" CHECK (
    ("type" = 'purchase' AND "status" IN (
      'draft', 'ordered', 'partially-received', 'received', 'cancelled'
    )) OR
    ("type" = 'sale' AND "status" IN (
      'draft', 'confirmed', 'partially-fulfilled', 'fulfilled',
      'partially-returned', 'returned', 'cancelled'
    )) OR
    ("type" = 'loan' AND "status" IN (
      'draft', 'reserved', 'partially-issued', 'issued',
      'partially-returned', 'returned', 'overdue', 'cancelled'
    ))
  );

COMMENT ON TABLE "order_line_units" IS
  'Lifecycle links between an order line and the concrete serialized units used to fulfill it.';
COMMENT ON COLUMN "order_line_units"."status" IS
  'Business state of a serialized unit on its order line: reserved, fulfilled, or returned.';
COMMENT ON COLUMN "order_lines"."returned_quantity" IS
  'Quantity returned after fulfillment for sales or loan orders; zero for purchases.';
