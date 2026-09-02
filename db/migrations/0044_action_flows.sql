ALTER TABLE "stock_scan_workflows"
  ADD COLUMN IF NOT EXISTS "identifier_storage" varchar(24) DEFAULT 'custom-field' NOT NULL,
  ADD COLUMN IF NOT EXISTS "extracted_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "operation" jsonb DEFAULT '{"type":"unit"}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "trigger_webhook" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "webhook_event_name" varchar(120)
    DEFAULT 'inventory.action.executed' NOT NULL;

-- Workflows created before action flows stored their values in the free-form
-- metadata object. Preserve that behavior while new flows default to typed
-- stock-unit custom fields.
UPDATE "stock_scan_workflows"
SET
  "identifier_storage" = 'metadata',
  "operation" = '{"type":"unit"}'::jsonb
WHERE "revision" >= 1
  AND "identifier_storage" = 'custom-field'
  AND "extracted_fields" = '[]'::jsonb
  AND "operation" = '{"type":"unit"}'::jsonb;

ALTER TABLE "stock_scan_workflows"
  ADD CONSTRAINT "stock_scan_workflows_identifier_storage_check"
    CHECK ("identifier_storage" IN ('custom-field', 'metadata', 'execution')),
  ADD CONSTRAINT "stock_scan_workflows_extracted_fields_array"
    CHECK (jsonb_typeof("extracted_fields") = 'array'),
  ADD CONSTRAINT "stock_scan_workflows_operation_object"
    CHECK (jsonb_typeof("operation") = 'object');

ALTER TABLE "webhook_endpoints"
  DROP CONSTRAINT IF EXISTS "webhook_endpoints_event_types_check";

ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_event_types_check" CHECK (
    "event_types" <@ ARRAY[
      'inventory.resource.created',
      'inventory.resource.updated',
      'inventory.resource.deleted',
      'inventory.resource.merged',
      'inventory.stock.movement.created',
      'inventory.action.executed'
    ]::text[]
  );

ALTER TABLE "webhook_events"
  DROP CONSTRAINT IF EXISTS "webhook_events_type_check";

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_type_check" CHECK (
    "type" IN (
      'inventory.resource.created',
      'inventory.resource.updated',
      'inventory.resource.deleted',
      'inventory.resource.merged',
      'inventory.stock.movement.created',
      'inventory.action.executed',
      'inventory.webhook.test'
    )
  );
