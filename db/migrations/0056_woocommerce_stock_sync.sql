ALTER TABLE "woocommerce_connections"
  ADD COLUMN IF NOT EXISTS "sync_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "encrypted_webhook_secret" text,
  ADD COLUMN IF NOT EXISTS "order_created_webhook_id" bigint,
  ADD COLUMN IF NOT EXISTS "order_updated_webhook_id" bigint,
  ADD COLUMN IF NOT EXISTS "last_webhook_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_sync_error" text;

CREATE TABLE IF NOT EXISTS "woocommerce_order_syncs" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL,
  "order_id" bigint NOT NULL,
  "order_number" varchar(80) NOT NULL,
  "order_status" varchar(80) NOT NULL,
  "status" varchar(16) DEFAULT 'succeeded' NOT NULL,
  "total_lines" integer DEFAULT 0 NOT NULL,
  "synced_lines" integer DEFAULT 0 NOT NULL,
  "last_delivery_id" varchar(160),
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "woocommerce_order_syncs_connection_fk"
    FOREIGN KEY ("organization_id", "connection_id")
    REFERENCES "woocommerce_connections"("organization_id", "id")
    ON DELETE CASCADE,
  CONSTRAINT "woocommerce_order_syncs_status_check"
    CHECK ("status" IN ('succeeded', 'partial', 'failed')),
  CONSTRAINT "woocommerce_order_syncs_counts_check"
    CHECK ("total_lines" >= 0 AND "synced_lines" >= 0 AND "synced_lines" <= "total_lines"),
  CONSTRAINT "woocommerce_order_syncs_order_positive"
    CHECK ("order_id" > 0),
  CONSTRAINT "woocommerce_order_syncs_tenant_order_unique"
    UNIQUE ("organization_id", "connection_id", "order_id")
);

CREATE INDEX IF NOT EXISTS "woocommerce_order_syncs_connection_updated_idx"
  ON "woocommerce_order_syncs" ("organization_id", "connection_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "woocommerce_order_syncs_issue_idx"
  ON "woocommerce_order_syncs" ("organization_id", "connection_id", "status")
  WHERE "status" <> 'succeeded';

CREATE TABLE IF NOT EXISTS "woocommerce_order_line_syncs" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL,
  "order_id" bigint NOT NULL,
  "line_item_id" bigint NOT NULL,
  "resource_id" uuid,
  "variant_id" uuid,
  "sku" varchar(80) NOT NULL DEFAULT '',
  "ordered_quantity" integer DEFAULT 0 NOT NULL,
  "refunded_quantity" integer DEFAULT 0 NOT NULL,
  "applied_quantity" integer DEFAULT 0 NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "status" varchar(16) DEFAULT 'synced' NOT NULL,
  "last_movement_id" uuid REFERENCES "stock_movements"("id") ON DELETE SET NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "woocommerce_order_line_syncs_pk"
    PRIMARY KEY ("organization_id", "connection_id", "order_id", "line_item_id"),
  CONSTRAINT "woocommerce_order_line_syncs_order_fk"
    FOREIGN KEY ("organization_id", "connection_id", "order_id")
    REFERENCES "woocommerce_order_syncs"("organization_id", "connection_id", "order_id")
    ON DELETE CASCADE,
  CONSTRAINT "woocommerce_order_line_syncs_resource_fk"
    FOREIGN KEY ("organization_id", "resource_id")
    REFERENCES "resources"("organization_id", "id")
    ON DELETE RESTRICT,
  CONSTRAINT "woocommerce_order_line_syncs_variant_fk"
    FOREIGN KEY ("variant_id", "resource_id")
    REFERENCES "resource_variants"("id", "resource_id")
    ON DELETE RESTRICT,
  CONSTRAINT "woocommerce_order_line_syncs_status_check"
    CHECK ("status" IN ('synced', 'unmapped', 'error')),
  CONSTRAINT "woocommerce_order_line_syncs_quantities_check"
    CHECK ("ordered_quantity" >= 0 AND "refunded_quantity" >= 0 AND "applied_quantity" >= 0 AND "revision" >= 0),
  CONSTRAINT "woocommerce_order_line_syncs_mapping_check"
    CHECK (("resource_id" IS NULL AND "variant_id" IS NULL) OR "resource_id" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "woocommerce_order_line_syncs_resource_idx"
  ON "woocommerce_order_line_syncs" ("organization_id", "resource_id");
CREATE INDEX IF NOT EXISTS "woocommerce_order_line_syncs_issue_idx"
  ON "woocommerce_order_line_syncs" ("organization_id", "connection_id", "status")
  WHERE "status" <> 'synced';

CREATE TABLE IF NOT EXISTS "woocommerce_webhook_deliveries" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL,
  "delivery_id" varchar(160) NOT NULL,
  "webhook_id" bigint,
  "topic" varchar(80) NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "order_id" bigint,
  "status" varchar(16) DEFAULT 'processing' NOT NULL,
  "error" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  CONSTRAINT "woocommerce_webhook_deliveries_pk"
    PRIMARY KEY ("organization_id", "connection_id", "delivery_id"),
  CONSTRAINT "woocommerce_webhook_deliveries_connection_fk"
    FOREIGN KEY ("organization_id", "connection_id")
    REFERENCES "woocommerce_connections"("organization_id", "id")
    ON DELETE CASCADE,
  CONSTRAINT "woocommerce_webhook_deliveries_status_check"
    CHECK ("status" IN ('processing', 'succeeded', 'failed')),
  CONSTRAINT "woocommerce_webhook_deliveries_payload_hash_check"
    CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS "woocommerce_webhook_deliveries_received_idx"
  ON "woocommerce_webhook_deliveries" ("organization_id", "connection_id", "received_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'woocommerce_connections_sync_webhooks_check'
  ) THEN
    ALTER TABLE "woocommerce_connections"
      ADD CONSTRAINT "woocommerce_connections_sync_webhooks_check"
      CHECK (
        NOT "sync_enabled" OR (
          "encrypted_webhook_secret" IS NOT NULL AND
          "order_created_webhook_id" IS NOT NULL AND
          "order_updated_webhook_id" IS NOT NULL
        )
      );
  END IF;
END $$;
