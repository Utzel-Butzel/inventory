-- Project canonical WooCommerce customers and orders into Inventory contacts
-- and sales orders. WooCommerce remains the source; these links make retries
-- idempotent without overloading user-editable names, e-mail addresses, or
-- order references as external identifiers.

CREATE TABLE "woocommerce_customer_links" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL,
  "customer_key" varchar(400) NOT NULL,
  "customer_id" bigint,
  "email" varchar(320),
  "contact_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "woocommerce_customer_links_pk"
    PRIMARY KEY ("organization_id", "connection_id", "customer_key"),
  CONSTRAINT "woocommerce_customer_links_connection_fk"
    FOREIGN KEY ("organization_id", "connection_id")
    REFERENCES "woocommerce_connections"("organization_id", "id")
    ON DELETE CASCADE,
  CONSTRAINT "woocommerce_customer_links_contact_fk"
    FOREIGN KEY ("organization_id", "contact_id")
    REFERENCES "contacts"("organization_id", "id")
    ON DELETE CASCADE,
  CONSTRAINT "woocommerce_customer_links_customer_id_check"
    CHECK ("customer_id" IS NULL OR "customer_id" > 0),
  CONSTRAINT "woocommerce_customer_links_email_normalized_check"
    CHECK ("email" IS NULL OR "email" = lower(btrim("email")))
);

CREATE INDEX "woocommerce_customer_links_contact_idx"
  ON "woocommerce_customer_links" ("organization_id", "contact_id");
CREATE UNIQUE INDEX "woocommerce_customer_links_customer_id_unique"
  ON "woocommerce_customer_links" (
    "organization_id", "connection_id", "customer_id"
  )
  WHERE "customer_id" IS NOT NULL;

ALTER TABLE "woocommerce_order_syncs"
  ADD COLUMN "contact_id" uuid,
  ADD COLUMN "local_order_id" uuid;

ALTER TABLE "woocommerce_order_syncs"
  ADD CONSTRAINT "woocommerce_order_syncs_contact_fk"
    FOREIGN KEY ("organization_id", "contact_id")
    REFERENCES "contacts"("organization_id", "id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "woocommerce_order_syncs_local_order_fk"
    FOREIGN KEY ("organization_id", "local_order_id")
    REFERENCES "orders"("organization_id", "id")
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX "woocommerce_order_syncs_local_order_unique"
  ON "woocommerce_order_syncs" (
    "organization_id", "connection_id", "local_order_id"
  )
  WHERE "local_order_id" IS NOT NULL;
CREATE INDEX "woocommerce_order_syncs_contact_idx"
  ON "woocommerce_order_syncs" ("organization_id", "contact_id");

ALTER TABLE "order_lines"
  ADD COLUMN "variant_id" uuid;

ALTER TABLE "order_lines"
  ADD CONSTRAINT "order_lines_variant_fk"
    FOREIGN KEY ("variant_id", "resource_id")
    REFERENCES "resource_variants"("id", "resource_id")
    ON DELETE RESTRICT;

-- User-created orders continue to reject duplicate resources in the service.
-- Imported carts need one local line per external line and may legitimately
-- contain two variants of the same parent resource.
DROP INDEX "order_lines_order_resource_unique";
CREATE INDEX "order_lines_order_resource_idx"
  ON "order_lines" ("order_id", "resource_id");

ALTER TABLE "woocommerce_order_line_syncs"
  ADD COLUMN "local_order_line_id" uuid;

ALTER TABLE "woocommerce_order_line_syncs"
  ADD CONSTRAINT "woocommerce_order_line_syncs_local_line_fk"
    FOREIGN KEY ("organization_id", "local_order_line_id")
    REFERENCES "order_lines"("organization_id", "id")
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX "woocommerce_order_line_syncs_local_line_unique"
  ON "woocommerce_order_line_syncs" (
    "organization_id", "connection_id", "local_order_line_id"
  )
  WHERE "local_order_line_id" IS NOT NULL;

COMMENT ON TABLE "woocommerce_customer_links" IS
  'Stable WooCommerce customer identities linked to Inventory contacts.';
COMMENT ON COLUMN "woocommerce_order_syncs"."local_order_id" IS
  'Inventory sales order projected from this canonical WooCommerce order.';
COMMENT ON COLUMN "woocommerce_order_line_syncs"."local_order_line_id" IS
  'Inventory sales-order line projected from this WooCommerce line.';
COMMENT ON COLUMN "order_lines"."variant_id" IS
  'Optional resource variant sold on this order line.';
