CREATE UNIQUE INDEX IF NOT EXISTS "order_line_units_organization_id_id_unique"
  ON "order_line_units" ("organization_id", "id");

CREATE TABLE "order_shipments" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "carrier_code" varchar(40) NOT NULL,
  "service" varchar(120),
  "tracking_number" varchar(180),
  "tracking_url" varchar(2048),
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "shipped_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "note" text DEFAULT '' NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "response" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_shipments_organization_order_fk"
    FOREIGN KEY ("organization_id", "order_id")
    REFERENCES "orders" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "order_shipments_status_check"
    CHECK ("status" IN ('draft', 'ready', 'shipped', 'in_transit', 'delivered', 'exception', 'returned', 'cancelled')),
  CONSTRAINT "order_shipments_carrier_code_check"
    CHECK ("carrier_code" ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  CONSTRAINT "order_shipments_tracking_number_nonempty"
    CHECK ("tracking_number" IS NULL OR length(btrim("tracking_number")) > 0),
  CONSTRAINT "order_shipments_shipped_timestamp_check"
    CHECK (("status" IN ('draft', 'ready', 'cancelled') AND "shipped_at" IS NULL) OR ("status" IN ('shipped', 'in_transit', 'delivered', 'exception', 'returned') AND "shipped_at" IS NOT NULL)),
  CONSTRAINT "order_shipments_delivered_timestamp_check"
    CHECK ("status" <> 'delivered' OR "delivered_at" IS NOT NULL),
  CONSTRAINT "order_shipments_timestamp_order_check"
    CHECK ("delivered_at" IS NULL OR "shipped_at" IS NULL OR "delivered_at" >= "shipped_at")
);

CREATE UNIQUE INDEX "order_shipments_organization_id_id_unique"
  ON "order_shipments" ("organization_id", "id");
CREATE UNIQUE INDEX "order_shipments_idempotency_key_unique"
  ON "order_shipments" ("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "order_shipments_tracking_unique"
  ON "order_shipments" ("organization_id", "carrier_code", "tracking_number")
  WHERE "tracking_number" IS NOT NULL;
CREATE INDEX "order_shipments_order_status_idx"
  ON "order_shipments" ("organization_id", "order_id", "status");
CREATE INDEX "order_shipments_status_shipped_idx"
  ON "order_shipments" ("organization_id", "status", "shipped_at");

CREATE TABLE "order_shipment_lines" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_id" uuid NOT NULL,
  "order_line_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_shipment_lines_organization_shipment_fk"
    FOREIGN KEY ("organization_id", "shipment_id")
    REFERENCES "order_shipments" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "order_shipment_lines_organization_order_line_fk"
    FOREIGN KEY ("organization_id", "order_line_id")
    REFERENCES "order_lines" ("organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "order_shipment_lines_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "order_shipment_lines_organization_id_id_unique"
  ON "order_shipment_lines" ("organization_id", "id");
CREATE UNIQUE INDEX "order_shipment_lines_shipment_order_line_unique"
  ON "order_shipment_lines" ("organization_id", "shipment_id", "order_line_id");
CREATE INDEX "order_shipment_lines_order_line_idx"
  ON "order_shipment_lines" ("organization_id", "order_line_id");

CREATE TABLE "order_shipment_units" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_line_id" uuid NOT NULL,
  "order_line_unit_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_shipment_units_organization_shipment_line_fk"
    FOREIGN KEY ("organization_id", "shipment_line_id")
    REFERENCES "order_shipment_lines" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "order_shipment_units_organization_order_line_unit_fk"
    FOREIGN KEY ("organization_id", "order_line_unit_id")
    REFERENCES "order_line_units" ("organization_id", "id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "order_shipment_units_line_unit_unique"
  ON "order_shipment_units" ("organization_id", "shipment_line_id", "order_line_unit_id");
CREATE INDEX "order_shipment_units_order_line_unit_idx"
  ON "order_shipment_units" ("organization_id", "order_line_unit_id");

CREATE TABLE "order_shipment_events" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_id" uuid NOT NULL,
  "from_status" varchar(24),
  "to_status" varchar(24) NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "actor" varchar(320),
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_shipment_events_organization_shipment_fk"
    FOREIGN KEY ("organization_id", "shipment_id")
    REFERENCES "order_shipments" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "order_shipment_events_from_status_check"
    CHECK ("from_status" IS NULL OR "from_status" IN ('draft', 'ready', 'shipped', 'in_transit', 'delivered', 'exception', 'returned', 'cancelled')),
  CONSTRAINT "order_shipment_events_to_status_check"
    CHECK ("to_status" IN ('draft', 'ready', 'shipped', 'in_transit', 'delivered', 'exception', 'returned', 'cancelled'))
);

CREATE INDEX "order_shipment_events_shipment_occurred_idx"
  ON "order_shipment_events" ("organization_id", "shipment_id", "occurred_at");

COMMENT ON TABLE "order_shipments" IS
  'Audited outbound parcels for sales orders. Carrier updates never write back to the commerce source.';
COMMENT ON TABLE "order_shipment_lines" IS
  'Partial quantities from fulfilled sales-order lines assigned to one parcel.';
COMMENT ON TABLE "order_shipment_units" IS
  'Concrete serialized order-line units packed into a parcel.';
COMMENT ON TABLE "order_shipment_events" IS
  'Immutable shipment status history including the actor and effective timestamp.';
