CREATE TABLE IF NOT EXISTS "woocommerce_connections" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_url" varchar(2048) NOT NULL,
  "consumer_key_hint" varchar(32) NOT NULL,
  "encrypted_consumer_key" text NOT NULL,
  "encrypted_consumer_secret" text NOT NULL,
  "status" varchar(16) DEFAULT 'connected' NOT NULL,
  "last_checked_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_error" text,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "woocommerce_connections_status_check"
    CHECK ("status" IN ('connected', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "woocommerce_connections_organization_unique"
  ON "woocommerce_connections" ("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "woocommerce_connections_organization_id_id_unique"
  ON "woocommerce_connections" ("organization_id", "id");
CREATE INDEX IF NOT EXISTS "woocommerce_connections_status_idx"
  ON "woocommerce_connections" ("status", "last_checked_at");

COMMENT ON TABLE "woocommerce_connections" IS
  'One encrypted WooCommerce REST API connection per organization.';
COMMENT ON COLUMN "woocommerce_connections"."consumer_key_hint" IS
  'Non-secret redacted Consumer Key label shown in the settings UI.';
