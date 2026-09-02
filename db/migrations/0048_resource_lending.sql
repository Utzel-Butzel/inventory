CREATE TABLE IF NOT EXISTS "resource_lending_settings" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "resource_id" uuid PRIMARY KEY REFERENCES "resources"("id") ON DELETE CASCADE,
  "enabled" boolean DEFAULT false NOT NULL,
  "approval_required" boolean DEFAULT true NOT NULL,
  "default_duration_days" integer DEFAULT 7 NOT NULL,
  "max_duration_days" integer DEFAULT 30 NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_lending_settings_organization_resource_fk"
    FOREIGN KEY ("organization_id", "resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "resource_lending_settings_default_duration_check"
    CHECK ("default_duration_days" BETWEEN 1 AND 3650),
  CONSTRAINT "resource_lending_settings_max_duration_check"
    CHECK (
      "max_duration_days" BETWEEN "default_duration_days" AND 3650
    )
);

CREATE INDEX IF NOT EXISTS "resource_lending_settings_enabled_idx"
  ON "resource_lending_settings" ("organization_id", "enabled");

-- Existing resources that already participate in checkouts or reservations
-- retain that behavior after lending becomes an explicit opt-in capability.
INSERT INTO "resource_lending_settings" (
  "organization_id",
  "resource_id",
  "enabled",
  "approval_required",
  "default_duration_days",
  "max_duration_days",
  "created_at",
  "updated_at"
)
SELECT DISTINCT
  assignment."organization_id",
  assignment."resource_id",
  true,
  true,
  7,
  30,
  now(),
  now()
FROM "inventory_assignments" AS assignment
WHERE assignment."kind" IN ('checkout', 'reservation')
ON CONFLICT ("resource_id") DO NOTHING;

ALTER TABLE "inventory_assignments"
  ADD COLUMN IF NOT EXISTS "stock_applied" boolean DEFAULT true NOT NULL;

CREATE INDEX IF NOT EXISTS "inventory_assignments_window_idx"
  ON "inventory_assignments" (
    "organization_id",
    "resource_id",
    "status",
    "starts_at",
    "due_at"
  );

COMMENT ON TABLE "resource_lending_settings" IS
  'Per-resource opt-in and duration policy for loans and reservations.';
COMMENT ON COLUMN "inventory_assignments"."stock_applied" IS
  'True once this assignment has changed the currently available stock. Future reservations remain false until checkout.';
