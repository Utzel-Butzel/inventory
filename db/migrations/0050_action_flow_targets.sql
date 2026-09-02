ALTER TABLE "stock_scan_workflows"
  ADD COLUMN IF NOT EXISTS "target_resource_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  ADD COLUMN IF NOT EXISTS "target_selection_mode" varchar(16) DEFAULT 'all' NOT NULL,
  ADD COLUMN IF NOT EXISTS "allow_variant_selection" boolean DEFAULT false NOT NULL;

UPDATE "stock_scan_workflows"
SET "target_resource_ids" = ARRAY["resource_id"]
WHERE cardinality("target_resource_ids") = 0;

ALTER TABLE "stock_scan_workflows"
  ADD CONSTRAINT "stock_scan_workflows_target_resource_ids_nonempty"
    CHECK (cardinality("target_resource_ids") > 0),
  ADD CONSTRAINT "stock_scan_workflows_target_selection_mode_check"
    CHECK ("target_selection_mode" IN ('all', 'radio', 'checkbox'));

COMMENT ON COLUMN "stock_scan_workflows"."resource_id" IS
  'Compatibility anchor for the first configured target; all targets are stored in target_resource_ids.';
