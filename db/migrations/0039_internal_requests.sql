CREATE TABLE IF NOT EXISTS "internal_requests" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reference" varchar(24) NOT NULL,
  "status" varchar(24) DEFAULT 'submitted' NOT NULL,
  "requester_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "requester_name" varchar(160) NOT NULL,
  "requester_email" varchar(320),
  "delivery_resource_id" uuid REFERENCES "resources"("id") ON DELETE SET NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "decision_note" text DEFAULT '' NOT NULL,
  "decided_by" varchar(320),
  "decided_at" timestamp with time zone,
  "fulfilled_by" varchar(320),
  "fulfilled_at" timestamp with time zone,
  "idempotency_key" uuid,
  "request_hash" varchar(64),
  "created_by" varchar(320) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "internal_requests_status_check" CHECK (
    "status" IN ('submitted', 'approved', 'rejected', 'fulfilled', 'cancelled')
  ),
  CONSTRAINT "internal_requests_window_check" CHECK ("due_at" > "starts_at"),
  CONSTRAINT "internal_requests_requester_name_nonempty" CHECK (
    length(btrim("requester_name")) > 0
  ),
  CONSTRAINT "internal_requests_idempotency_fields_consistent" CHECK (
    ("idempotency_key" IS NULL AND "request_hash" IS NULL)
    OR
    ("idempotency_key" IS NOT NULL AND "request_hash" ~ '^[0-9a-f]{64}$')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "internal_requests_organization_id_id_unique"
  ON "internal_requests" ("organization_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "internal_requests_reference_unique"
  ON "internal_requests" ("organization_id", "reference");
CREATE UNIQUE INDEX IF NOT EXISTS "internal_requests_idempotency_key_unique"
  ON "internal_requests" ("organization_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "internal_requests_status_starts_idx"
  ON "internal_requests" ("organization_id", "status", "starts_at");
CREATE INDEX IF NOT EXISTS "internal_requests_requester_idx"
  ON "internal_requests" ("organization_id", "requester_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "internal_requests_window_idx"
  ON "internal_requests" ("organization_id", "starts_at", "due_at");

CREATE TABLE IF NOT EXISTS "internal_request_lines" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "internal_requests"("id") ON DELETE CASCADE,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "internal_request_lines_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "internal_request_lines_organization_id_id_unique"
  ON "internal_request_lines" ("organization_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "internal_request_lines_request_resource_unique"
  ON "internal_request_lines" ("request_id", "resource_id");
CREATE INDEX IF NOT EXISTS "internal_request_lines_resource_idx"
  ON "internal_request_lines" ("organization_id", "resource_id");

CREATE TABLE IF NOT EXISTS "internal_request_events" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "internal_requests"("id") ON DELETE CASCADE,
  "type" varchar(24) NOT NULL,
  "actor" varchar(320) NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "internal_request_events_type_check" CHECK (
    "type" IN ('submitted', 'approved', 'rejected', 'fulfilled', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS "internal_request_events_request_occurred_idx"
  ON "internal_request_events" ("organization_id", "request_id", "occurred_at");

ALTER TABLE "inventory_assignments"
  ADD COLUMN IF NOT EXISTS "internal_request_line_id" uuid;
ALTER TABLE "inventory_assignments"
  ADD CONSTRAINT "inventory_assignments_internal_request_line_id_fkey"
  FOREIGN KEY ("internal_request_line_id")
  REFERENCES "internal_request_lines"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "inventory_assignments_internal_request_line_idx"
  ON "inventory_assignments" ("internal_request_line_id");

UPDATE "access_roles"
SET "permissions" = "permissions" || ARRAY[
  'requests.read', 'requests.create', 'requests.manage'
]::text[]
WHERE "key" IN ('admin', 'editor')
  AND NOT ("permissions" @> ARRAY['requests.read']::text[]);

UPDATE "access_roles"
SET "permissions" = "permissions" || ARRAY['requests.read']::text[]
WHERE "key" = 'viewer'
  AND NOT ("permissions" @> ARRAY['requests.read']::text[]);

COMMENT ON TABLE "internal_requests" IS
  'Employee equipment and material requests with approval, reservation, and fulfillment lifecycle.';
COMMENT ON TABLE "internal_request_lines" IS
  'Requested inventory quantities that reserve availability only after approval.';
COMMENT ON TABLE "internal_request_events" IS
  'Append-only lifecycle history for an internal request.';
