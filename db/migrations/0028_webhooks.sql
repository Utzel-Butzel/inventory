CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "encrypted_url" text NOT NULL,
  "redacted_url" varchar(500) NOT NULL,
  "encrypted_secret" text NOT NULL,
  "event_types" text[] NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "last_success_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "webhook_endpoints_event_types_nonempty" CHECK (cardinality("event_types") > 0),
  CONSTRAINT "webhook_endpoints_event_types_check" CHECK (
    "event_types" <@ ARRAY[
      'inventory.resource.created',
      'inventory.resource.updated',
      'inventory.resource.deleted',
      'inventory.resource.merged',
      'inventory.stock.movement.created'
    ]::text[]
  ),
  CONSTRAINT "webhook_endpoints_failure_count_nonnegative" CHECK ("failure_count" >= 0)
);

CREATE INDEX IF NOT EXISTS "webhook_endpoints_active_idx"
  ON "webhook_endpoints" ("enabled", "revoked_at");
CREATE INDEX IF NOT EXISTS "webhook_endpoints_revoked_idx"
  ON "webhook_endpoints" ("revoked_at") WHERE "revoked_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "type" varchar(80) NOT NULL,
  "api_version" varchar(8) DEFAULT '1' NOT NULL,
  "aggregate_type" varchar(80),
  "aggregate_id" varchar(160),
  "actor" varchar(320),
  "payload" jsonb NOT NULL,
  "body" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_events_api_version_check" CHECK ("api_version" = '1'),
  CONSTRAINT "webhook_events_type_check" CHECK (
    "type" IN (
      'inventory.resource.created',
      'inventory.resource.updated',
      'inventory.resource.deleted',
      'inventory.resource.merged',
      'inventory.stock.movement.created',
      'inventory.webhook.test'
    )
  ),
  CONSTRAINT "webhook_events_payload_object" CHECK (jsonb_typeof("payload") = 'object')
);

CREATE INDEX IF NOT EXISTS "webhook_events_occurred_idx"
  ON "webhook_events" ("occurred_at");
CREATE INDEX IF NOT EXISTS "webhook_events_created_idx"
  ON "webhook_events" ("created_at");
CREATE INDEX IF NOT EXISTS "webhook_events_aggregate_idx"
  ON "webhook_events" ("aggregate_type", "aggregate_id");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "webhook_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT,
  "event_id" uuid NOT NULL REFERENCES "webhook_events"("id") ON DELETE CASCADE,
  "encrypted_secret" text NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "http_status" integer,
  "error" text,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_deliveries_endpoint_event_unique" UNIQUE ("webhook_id", "event_id"),
  CONSTRAINT "webhook_deliveries_status_check" CHECK (
    "status" IN ('pending', 'processing', 'succeeded', 'failed')
  ),
  CONSTRAINT "webhook_deliveries_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "webhook_deliveries_processing_lease_check" CHECK (
    ("status" = 'processing' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR
    ("status" <> 'processing' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "webhook_deliveries_http_status_check" CHECK (
    "http_status" IS NULL OR "http_status" BETWEEN 100 AND 599
  )
);

CREATE INDEX IF NOT EXISTS "webhook_deliveries_due_idx"
  ON "webhook_deliveries" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_idx"
  ON "webhook_deliveries" ("event_id");

UPDATE "access_roles"
SET
  "permissions" = array_append("permissions", 'webhooks.manage'),
  "updated_at" = now(),
  "updated_by" = 'migration'
WHERE "key" = 'admin'
  AND NOT ('webhooks.manage' = ANY("permissions"));
