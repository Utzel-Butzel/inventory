ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "ai_monthly_budget_micros" bigint;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_ai_monthly_budget_nonnegative"
  CHECK (
    "ai_monthly_budget_micros" IS NULL
    OR "ai_monthly_budget_micros" >= 0
  );

CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" varchar(40) NOT NULL,
  "provider" varchar(24) NOT NULL,
  "model" varchar(240) NOT NULL,
  "status" varchar(16) DEFAULT 'running' NOT NULL,
  "cost_micros" bigint NOT NULL,
  "cost_estimated" boolean DEFAULT true NOT NULL,
  "actor" varchar(320) NOT NULL,
  "actor_name" varchar(160),
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "token_id" uuid,
  "resource_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "ai_usage_events_action_check"
    CHECK ("action" IN (
      'inventory_analysis',
      'inventory_research',
      'image_search',
      'inventory_recognition',
      'photo_count',
      'image_generation',
      'translation',
      'room_analysis'
    )),
  CONSTRAINT "ai_usage_events_provider_check"
    CHECK ("provider" IN ('openai', 'google', 'replicate')),
  CONSTRAINT "ai_usage_events_status_check"
    CHECK ("status" IN ('running', 'succeeded', 'failed')),
  CONSTRAINT "ai_usage_events_cost_nonnegative"
    CHECK ("cost_micros" >= 0)
);

CREATE INDEX IF NOT EXISTS "ai_usage_events_org_created_idx"
  ON "ai_usage_events" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_usage_events_org_action_created_idx"
  ON "ai_usage_events" ("organization_id", "action", "created_at");

-- Replace the former all-or-nothing AI grant with one permission per paid
-- capability. Existing roles and conditional rules retain their prior access.
UPDATE "access_roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(
    array_remove("permissions", 'ai.use') || ARRAY[
      'ai.analyze',
      'ai.research',
      'ai.recognize',
      'ai.count',
      'ai.images',
      'ai.translate',
      'ai.rooms'
    ]::text[]
  ) AS permission
  ORDER BY permission
)
WHERE 'ai.use' = ANY("permissions");

UPDATE "inventory_access_rules"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(
    array_remove("permissions", 'ai.use') || ARRAY[
      'ai.analyze',
      'ai.research',
      'ai.recognize',
      'ai.count',
      'ai.images',
      'ai.translate',
      'ai.rooms'
    ]::text[]
  ) AS permission
  ORDER BY permission
)
WHERE 'ai.use' = ANY("permissions");

COMMENT ON COLUMN "organizations"."ai_monthly_budget_micros" IS
  'Optional monthly estimated AI spend ceiling in millionths of USD. NULL means unlimited and zero disables paid AI.';
COMMENT ON TABLE "ai_usage_events" IS
  'Per-attempt estimated cost ledger for paid AI provider calls. Running and failed attempts remain budgeted because providers may still charge them.';
