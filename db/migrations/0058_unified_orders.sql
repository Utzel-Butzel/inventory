-- Purchase orders, sales orders, and loans share one order header and line
-- model. Existing purchase-order identifiers are preserved during the rename.
ALTER TABLE "purchase_orders" RENAME TO "orders";
ALTER TABLE "purchase_order_lines" RENAME TO "order_lines";

ALTER TABLE "orders" RENAME COLUMN "supplier" TO "contact_name";
ALTER TABLE "orders"
  ADD COLUMN "type" varchar(16) DEFAULT 'purchase' NOT NULL,
  ADD COLUMN "contact_id" uuid;

-- Older purchase orders could contain an empty supplier even though the
-- column itself was required. Give those rows a stable, identifiable snapshot
-- before enforcing the stronger shared-order invariant below.
UPDATE "orders"
SET "contact_name" = coalesce(
  nullif(btrim("reference"), ''),
  concat('Legacy supplier ', left("id"::text, 8))
)
WHERE length(btrim("contact_name")) = 0;

ALTER TABLE "order_lines" RENAME COLUMN "purchase_order_id" TO "order_id";
ALTER TABLE "order_lines" RENAME COLUMN "ordered_quantity" TO "quantity";
ALTER TABLE "order_lines" RENAME COLUMN "received_quantity" TO "fulfilled_quantity";
ALTER TABLE "order_lines"
  ADD COLUMN "returned_quantity" integer DEFAULT 0 NOT NULL;

ALTER TABLE "purchase_receipts"
  RENAME COLUMN "purchase_order_line_id" TO "order_line_id";

ALTER TABLE "stock_movements"
  ADD COLUMN "order_line_id" uuid;

ALTER TABLE "orders" DROP CONSTRAINT "purchase_orders_status_check";
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_type_status_check" CHECK (
    ("type" = 'purchase' AND "status" IN (
      'draft', 'ordered', 'partially-received', 'received', 'cancelled'
    )) OR
    ("type" = 'sale' AND "status" IN (
      'draft', 'confirmed', 'partially-fulfilled', 'fulfilled', 'cancelled'
    )) OR
    ("type" = 'loan' AND "status" IN (
      'draft', 'reserved', 'partially-issued', 'issued',
      'partially-returned', 'returned', 'overdue', 'cancelled'
    ))
  );
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_contact_name_nonempty"
  CHECK (length(btrim("contact_name")) > 0);

ALTER TABLE "order_lines"
  RENAME CONSTRAINT "purchase_order_lines_ordered_quantity_positive"
  TO "order_lines_quantity_positive";
ALTER TABLE "order_lines"
  RENAME CONSTRAINT "purchase_order_lines_received_quantity_nonnegative"
  TO "order_lines_fulfilled_quantity_nonnegative";
ALTER TABLE "order_lines"
  RENAME CONSTRAINT "purchase_order_lines_received_not_above_ordered"
  TO "order_lines_fulfilled_not_above_quantity";
ALTER TABLE "order_lines"
  RENAME CONSTRAINT "purchase_order_lines_purchase_unit_valid"
  TO "order_lines_purchase_unit_valid";
ALTER TABLE "order_lines"
  RENAME CONSTRAINT "purchase_order_lines_unit_price_nonnegative"
  TO "order_lines_unit_price_nonnegative";
ALTER TABLE "order_lines"
  RENAME CONSTRAINT "purchase_order_lines_price_fields_together"
  TO "order_lines_price_fields_together";
ALTER TABLE "order_lines"
  ADD CONSTRAINT "order_lines_returned_quantity_valid"
  CHECK (
    "returned_quantity" >= 0
    AND "returned_quantity" <= "fulfilled_quantity"
  );

ALTER INDEX "purchase_orders_pkey" RENAME TO "orders_pkey";
ALTER INDEX "purchase_order_lines_pkey" RENAME TO "order_lines_pkey";
ALTER INDEX "purchase_orders_idempotency_key_unique"
  RENAME TO "orders_idempotency_key_unique";
ALTER INDEX "purchase_orders_status_idx" RENAME TO "orders_type_status_idx";
DROP INDEX "orders_type_status_idx";
CREATE INDEX "orders_type_status_idx"
  ON "orders" ("organization_id", "type", "status");
ALTER INDEX "purchase_orders_expected_at_idx" RENAME TO "orders_expected_at_idx";
DROP INDEX "orders_expected_at_idx";
CREATE INDEX "orders_expected_at_idx"
  ON "orders" ("organization_id", "expected_at");
ALTER INDEX "purchase_order_lines_order_resource_unique"
  RENAME TO "order_lines_order_resource_unique";
ALTER INDEX "purchase_order_lines_purchase_order_id_idx"
  RENAME TO "order_lines_order_id_idx";
ALTER INDEX "purchase_order_lines_resource_id_idx"
  RENAME TO "order_lines_resource_id_idx";
ALTER INDEX "purchase_receipts_purchase_order_line_id_idx"
  RENAME TO "purchase_receipts_order_line_id_idx";

CREATE UNIQUE INDEX "orders_organization_id_id_unique"
  ON "orders" ("organization_id", "id");
CREATE INDEX "orders_contact_id_idx"
  ON "orders" ("organization_id", "contact_id");
CREATE INDEX "stock_movements_order_line_id_idx"
  ON "stock_movements" ("order_line_id");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_organization_contact_fk"
  FOREIGN KEY ("organization_id", "contact_id")
  REFERENCES "contacts" ("organization_id", "id")
  ON DELETE RESTRICT;
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_order_line_id_fkey"
  FOREIGN KEY ("order_line_id") REFERENCES "order_lines" ("id")
  ON DELETE SET NULL;

-- Connect legacy supplier text to an existing supplier contact whenever the
-- name or company matches. The text snapshot remains immutable order history.
UPDATE "orders" AS order_record
SET "contact_id" = (
  SELECT contact."id"
  FROM "contacts" AS contact
  WHERE contact."organization_id" = order_record."organization_id"
    AND 'supplier' = ANY(contact."roles")
    AND (
      lower(btrim(contact."name")) = lower(btrim(order_record."contact_name"))
      OR lower(btrim(coalesce(contact."company", ''))) =
        lower(btrim(order_record."contact_name"))
    )
  ORDER BY contact."created_at", contact."id"
  LIMIT 1
)
WHERE order_record."type" = 'purchase'
  AND order_record."contact_id" IS NULL;

COMMENT ON TABLE "orders" IS
  'Shared headers for purchase orders, sales orders, and multi-item loans.';
COMMENT ON TABLE "order_lines" IS
  'Inventory positions shared by purchase, sale, and loan orders.';
COMMENT ON COLUMN "order_lines"."fulfilled_quantity" IS
  'Received quantity for purchases and issued quantity for sales or loans.';
COMMENT ON COLUMN "order_lines"."returned_quantity" IS
  'Quantity returned for loan orders; zero for purchases and sales.';
COMMENT ON COLUMN "stock_movements"."order_line_id" IS
  'Optional originating purchase, sales, or loan order line.';
