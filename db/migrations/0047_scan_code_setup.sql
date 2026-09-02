ALTER TABLE "stock_scan_workflows"
  ADD COLUMN IF NOT EXISTS "code_types" text[] DEFAULT ARRAY[
    'qr_code', 'data_matrix', 'aztec', 'pdf417', 'code_128', 'code_93',
    'code_39', 'codabar', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'
  ]::text[] NOT NULL;

ALTER TABLE "stock_scan_workflows"
  ADD CONSTRAINT "stock_scan_workflows_code_types_nonempty"
    CHECK (cardinality("code_types") > 0),
  ADD CONSTRAINT "stock_scan_workflows_code_types_check"
    CHECK (
      "code_types" <@ ARRAY[
        'qr_code', 'data_matrix', 'aztec', 'pdf417', 'code_128', 'code_93',
        'code_39', 'codabar', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'
      ]::text[]
    );

ALTER TABLE "stock_scan_executions"
  ADD COLUMN IF NOT EXISTS "code_type" varchar(32),
  ADD CONSTRAINT "stock_scan_executions_code_type_check" CHECK (
    "code_type" IS NULL OR "code_type" IN (
      'qr_code', 'data_matrix', 'aztec', 'pdf417', 'code_128', 'code_93',
      'code_39', 'codabar', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'
    )
  );

COMMENT ON COLUMN "stock_scan_workflows"."code_types" IS
  'Scanner symbologies accepted by this action flow. Missing symbology metadata from manual or legacy clients remains allowed.';
COMMENT ON COLUMN "stock_scan_executions"."code_type" IS
  'Normalized scanner symbology reported by the client, or NULL for manual and legacy input.';

ALTER TABLE "ai_usage_events"
  DROP CONSTRAINT IF EXISTS "ai_usage_events_action_check";

ALTER TABLE "ai_usage_events"
  ADD CONSTRAINT "ai_usage_events_action_check" CHECK (
    "action" IN (
      'inventory_analysis', 'inventory_research', 'image_search',
      'inventory_recognition', 'photo_count', 'image_generation',
      'translation', 'room_analysis', 'workflow_extraction'
    )
  );
