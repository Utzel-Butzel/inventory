ALTER TABLE "bom_lines"
  ADD COLUMN IF NOT EXISTS "quantity_unit" varchar(16) DEFAULT 'base' NOT NULL;

ALTER TABLE "bom_lines"
  ADD CONSTRAINT "bom_lines_quantity_unit_check"
  CHECK ("quantity_unit" IN ('base', 'purchase'));

ALTER TABLE "variant_bom_overrides"
  ADD COLUMN IF NOT EXISTS "quantity_unit" varchar(16);

UPDATE "variant_bom_overrides"
SET "quantity_unit" = 'base'
WHERE NOT "removed" AND "quantity_unit" IS NULL;

ALTER TABLE "variant_bom_overrides"
  DROP CONSTRAINT "variant_bom_overrides_payload_check";

ALTER TABLE "variant_bom_overrides"
  ADD CONSTRAINT "variant_bom_overrides_payload_check"
  CHECK (
    (
      "removed"
      AND "component_resource_id" IS NULL
      AND "quantity_per_assembly" IS NULL
      AND "quantity_unit" IS NULL
    )
    OR
    (
      NOT "removed"
      AND "component_resource_id" IS NOT NULL
      AND "quantity_per_assembly" > 0
      AND "quantity_unit" IN ('base', 'purchase')
      AND "position" IS NOT NULL
    )
  );

COMMENT ON COLUMN "bom_lines"."quantity_unit" IS
  'Unit used to present quantity_per_assembly; the stored quantity remains in base stock units.';

COMMENT ON COLUMN "variant_bom_overrides"."quantity_unit" IS
  'Unit used to present quantity_per_assembly; the stored quantity remains in base stock units.';
