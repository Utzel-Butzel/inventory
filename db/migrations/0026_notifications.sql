CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "recipient_key" varchar(320) PRIMARY KEY NOT NULL,
  "recipient_email" varchar(320),
  "recipient_name" varchar(160),
  "enabled_event_types" text[] DEFAULT ARRAY['low_stock', 'expiry', 'maintenance', 'return_due']::text[] NOT NULL,
  "frequency" varchar(24) DEFAULT 'daily' NOT NULL,
  "digest_hour" integer DEFAULT 8 NOT NULL,
  "timezone" varchar(80) DEFAULT 'UTC' NOT NULL,
  "locale" varchar(8) DEFAULT 'en' NOT NULL,
  "cooldown_hours" integer DEFAULT 24 NOT NULL,
  "low_stock_threshold_percent" integer DEFAULT 100 NOT NULL,
  "expiry_window_days" integer DEFAULT 30 NOT NULL,
  "expiry_field_key" varchar(120) DEFAULT 'expiry_date' NOT NULL,
  "maintenance_window_days" integer DEFAULT 7 NOT NULL,
  "maintenance_field_key" varchar(120) DEFAULT 'maintenance_due' NOT NULL,
  "return_due_window_days" integer DEFAULT 3 NOT NULL,
  "email_enabled" boolean DEFAULT false NOT NULL,
  "push_enabled" boolean DEFAULT false NOT NULL,
  "slack_enabled" boolean DEFAULT false NOT NULL,
  "teams_enabled" boolean DEFAULT false NOT NULL,
  "webhook_enabled" boolean DEFAULT false NOT NULL,
  "last_digest_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_preferences_event_types_check"
    CHECK ("enabled_event_types" <@ ARRAY['low_stock', 'expiry', 'maintenance', 'return_due']::text[]),
  CONSTRAINT "notification_preferences_frequency_check"
    CHECK ("frequency" IN ('daily', 'immediate')),
  CONSTRAINT "notification_preferences_digest_hour_check"
    CHECK ("digest_hour" BETWEEN 0 AND 23),
  CONSTRAINT "notification_preferences_locale_check"
    CHECK ("locale" IN ('en', 'de')),
  CONSTRAINT "notification_preferences_cooldown_check"
    CHECK ("cooldown_hours" BETWEEN 1 AND 720),
  CONSTRAINT "notification_preferences_low_stock_threshold_check"
    CHECK ("low_stock_threshold_percent" BETWEEN 1 AND 500),
  CONSTRAINT "notification_preferences_expiry_window_check"
    CHECK ("expiry_window_days" BETWEEN 0 AND 3650),
  CONSTRAINT "notification_preferences_maintenance_window_check"
    CHECK ("maintenance_window_days" BETWEEN 0 AND 3650),
  CONSTRAINT "notification_preferences_return_due_window_check"
    CHECK ("return_due_window_days" BETWEEN 0 AND 365)
);

CREATE TABLE IF NOT EXISTS "notification_inbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_key" varchar(320) NOT NULL REFERENCES "notification_preferences"("recipient_key") ON DELETE CASCADE,
  "event_type" varchar(32) NOT NULL,
  "resource_id" uuid REFERENCES "resources"("id") ON DELETE SET NULL,
  "assignment_id" uuid REFERENCES "inventory_assignments"("id") ON DELETE SET NULL,
  "source_key" varchar(420) NOT NULL,
  "dedupe_bucket" varchar(64) NOT NULL,
  "title" varchar(240) NOT NULL,
  "body" text NOT NULL,
  "href" varchar(500),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_inbox_event_type_check"
    CHECK ("event_type" IN ('low_stock', 'expiry', 'maintenance', 'return_due')),
  CONSTRAINT "notification_inbox_metadata_object"
    CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_inbox_dedupe_unique"
  ON "notification_inbox" ("recipient_key", "event_type", "source_key", "dedupe_bucket");
CREATE INDEX IF NOT EXISTS "notification_inbox_recipient_created_idx"
  ON "notification_inbox" ("recipient_key", "created_at");
CREATE INDEX IF NOT EXISTS "notification_inbox_recipient_unread_idx"
  ON "notification_inbox" ("recipient_key", "read_at");

CREATE TABLE IF NOT EXISTS "notification_dispatches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_key" varchar(320) NOT NULL REFERENCES "notification_preferences"("recipient_key") ON DELETE CASCADE,
  "channel" varchar(24) NOT NULL,
  "dedupe_key" varchar(64) NOT NULL,
  "status" varchar(24) NOT NULL,
  "event_count" integer DEFAULT 0 NOT NULL,
  "target_redacted" varchar(500),
  "error" text,
  "preview" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "notification_dispatches_channel_check"
    CHECK ("channel" IN ('email', 'push', 'slack', 'teams', 'webhook')),
  CONSTRAINT "notification_dispatches_status_check"
    CHECK ("status" IN ('sending', 'sent', 'skipped', 'failed', 'preview')),
  CONSTRAINT "notification_dispatches_event_count_check"
    CHECK ("event_count" >= 0)
);

CREATE INDEX IF NOT EXISTS "notification_dispatches_recipient_created_idx"
  ON "notification_dispatches" ("recipient_key", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "notification_dispatches_dedupe_unique"
  ON "notification_dispatches" ("dedupe_key");

CREATE TABLE IF NOT EXISTS "notification_push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_key" varchar(320) NOT NULL REFERENCES "notification_preferences"("recipient_key") ON DELETE CASCADE,
  "endpoint_hash" varchar(64) NOT NULL,
  "encrypted_subscription" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "notification_push_subscriptions_endpoint_hash_check"
    CHECK ("endpoint_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_push_subscriptions_endpoint_unique"
  ON "notification_push_subscriptions" ("endpoint_hash");
CREATE INDEX IF NOT EXISTS "notification_push_subscriptions_recipient_idx"
  ON "notification_push_subscriptions" ("recipient_key", "revoked_at");

COMMENT ON TABLE "notification_preferences" IS
  'Per-recipient anti-noise thresholds, digest cadence, locale, and explicit external-channel opt-ins.';
COMMENT ON TABLE "notification_inbox" IS
  'Deduplicated in-app notification mailbox. External dispatch reads from this same durable event stream.';
COMMENT ON TABLE "notification_push_subscriptions" IS
  'Web Push subscriptions encrypted by the deployment-level NOTIFICATION_ENCRYPTION_KEY.';
