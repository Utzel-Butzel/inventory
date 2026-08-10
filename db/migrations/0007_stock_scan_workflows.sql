CREATE TABLE IF NOT EXISTS "stock_scan_workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "revision" integer DEFAULT 1 NOT NULL,
  "extraction" jsonb NOT NULL,
  "identifier_property_key" varchar(80) NOT NULL,
  "create_missing_unit" boolean DEFAULT false NOT NULL,
  "unit_status" varchar(32),
  "fixed_properties" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "input_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_scan_workflows_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "stock_scan_workflows_unit_status_check" CHECK (
    "unit_status" IS NULL OR "unit_status" IN (
      'available', 'reserved', 'in-use', 'maintenance',
      'consumed', 'lost', 'retired'
    )
  ),
  CONSTRAINT "stock_scan_workflows_extraction_object" CHECK (
    jsonb_typeof("extraction") = 'object'
  ),
  CONSTRAINT "stock_scan_workflows_fixed_properties_array" CHECK (
    jsonb_typeof("fixed_properties") = 'array'
  ),
  CONSTRAINT "stock_scan_workflows_input_fields_array" CHECK (
    jsonb_typeof("input_fields") = 'array'
  )
);

CREATE INDEX IF NOT EXISTS "stock_scan_workflows_resource_id_idx"
  ON "stock_scan_workflows" ("resource_id");
CREATE INDEX IF NOT EXISTS "stock_scan_workflows_enabled_idx"
  ON "stock_scan_workflows" ("enabled");

CREATE TABLE IF NOT EXISTS "stock_scan_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "workflow_id" uuid REFERENCES "stock_scan_workflows"("id") ON DELETE SET NULL,
  "workflow_revision" integer NOT NULL,
  "resource_id" uuid REFERENCES "resources"("id") ON DELETE SET NULL,
  "unit_id" uuid REFERENCES "stock_units"("id") ON DELETE SET NULL,
  "request_hash" varchar(64) NOT NULL,
  "code_hash" varchar(64) NOT NULL,
  "actor" varchar(320) NOT NULL,
  "created_unit" boolean DEFAULT false NOT NULL,
  "before_metadata" jsonb,
  "after_metadata" jsonb NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_scan_executions_workflow_revision_positive"
    CHECK ("workflow_revision" > 0),
  CONSTRAINT "stock_scan_executions_before_metadata_object" CHECK (
    "before_metadata" IS NULL OR jsonb_typeof("before_metadata") = 'object'
  ),
  CONSTRAINT "stock_scan_executions_after_metadata_object" CHECK (
    jsonb_typeof("after_metadata") = 'object'
  ),
  CONSTRAINT "stock_scan_executions_response_object" CHECK (
    jsonb_typeof("response") = 'object'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_scan_executions_idempotency_key_unique"
  ON "stock_scan_executions" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "stock_scan_executions_workflow_id_idx"
  ON "stock_scan_executions" ("workflow_id");
CREATE INDEX IF NOT EXISTS "stock_scan_executions_resource_id_idx"
  ON "stock_scan_executions" ("resource_id");
CREATE INDEX IF NOT EXISTS "stock_scan_executions_unit_id_idx"
  ON "stock_scan_executions" ("unit_id");

COMMENT ON TABLE "stock_scan_executions" IS
  'Immutable audit and idempotency records for workflow-driven stock scans.';
