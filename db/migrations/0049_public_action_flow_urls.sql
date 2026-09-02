ALTER TABLE "stock_scan_workflows"
  ADD COLUMN IF NOT EXISTS "public_trigger_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "public_trigger_id" uuid,
  ADD COLUMN IF NOT EXISTS "public_trigger_code" text,
  ADD COLUMN IF NOT EXISTS "quantity_input_key" varchar(80);

UPDATE "stock_scan_workflows"
SET "public_trigger_id" = gen_random_uuid()
WHERE "public_trigger_id" IS NULL;

ALTER TABLE "stock_scan_workflows"
  ALTER COLUMN "public_trigger_id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "public_trigger_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "stock_scan_workflows_public_trigger_id_unique"
  ON "stock_scan_workflows" ("public_trigger_id");

ALTER TABLE "stock_scan_workflows"
  DROP CONSTRAINT IF EXISTS "stock_scan_workflows_public_trigger_code_length",
  ADD CONSTRAINT "stock_scan_workflows_public_trigger_code_length"
    CHECK ("public_trigger_code" IS NULL OR length("public_trigger_code") BETWEEN 1 AND 2048),
  DROP CONSTRAINT IF EXISTS "stock_scan_workflows_quantity_input_key_shape",
  ADD CONSTRAINT "stock_scan_workflows_quantity_input_key_shape"
    CHECK (
      "quantity_input_key" IS NULL
      OR "quantity_input_key" ~ '^[A-Za-z0-9_.-]{1,80}$'
    );

COMMENT ON COLUMN "stock_scan_workflows"."public_trigger_id" IS
  'Unlistable bearer identifier used by the public action-flow URL.';
COMMENT ON COLUMN "stock_scan_workflows"."public_trigger_code" IS
  'Optional fixed code value used when a public action URL is submitted.';
COMMENT ON COLUMN "stock_scan_workflows"."quantity_input_key" IS
  'Required number input whose value overrides the configured operation magnitude.';
