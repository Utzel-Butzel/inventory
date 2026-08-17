-- First-class resource variants remain ordinary inventory resources. Their
-- family membership is a protected child -> primary `variant_of` edge, while
-- relation attributes remember which shared catalog fields were overridden.
ALTER TABLE "resource_relations"
  ADD COLUMN IF NOT EXISTS "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'resource_relations_attributes_object'
  ) THEN
    ALTER TABLE "resource_relations"
      ADD CONSTRAINT "resource_relations_attributes_object"
      CHECK (jsonb_typeof("attributes") = 'object');
  END IF;
END $$;

INSERT INTO "relation_type_definitions" (
  "organization_id", "key", "label", "inverse_label", "description",
  "allow_manual", "spatial", "position", "is_system",
  "created_by", "updated_by"
)
SELECT
  "id", 'variant_of', 'Variant of', 'Variants',
  'Connects a first-class inventory variant to its primary item.',
  false, false, 15, true, 'migration', 'migration'
FROM "organizations"
ON CONFLICT ("organization_id", "key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "inverse_label" = EXCLUDED."inverse_label",
  "description" = EXCLUDED."description",
  "allow_manual" = false,
  "spatial" = false,
  "is_system" = true,
  "updated_by" = 'migration',
  "updated_at" = now(),
  "archived_at" = null;

CREATE UNIQUE INDEX IF NOT EXISTS "resource_relations_variant_source_unique"
  ON "resource_relations" ("organization_id", "source_resource_id")
  WHERE "relation_type_key" = 'variant_of';

-- Stable BOM slots let a variant replace or remove one logical part while all
-- other slots continue to follow the primary BOM.
ALTER TABLE "bom_lines"
  ADD COLUMN IF NOT EXISTS "slot_key" varchar(80);

UPDATE "bom_lines"
SET "slot_key" = "id"::text
WHERE "slot_key" IS NULL;

ALTER TABLE "bom_lines"
  ALTER COLUMN "slot_key" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "bom_lines_assembly_slot_unique"
  ON "bom_lines" ("assembly_resource_id", "slot_key");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bom_lines_slot_key_check'
  ) THEN
    ALTER TABLE "bom_lines"
      ADD CONSTRAINT "bom_lines_slot_key_check"
      CHECK ("slot_key" ~ '^[A-Za-z0-9_-]{1,80}$');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "variant_bom_overrides" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "variant_resource_id" uuid NOT NULL
    REFERENCES "resources"("id") ON DELETE CASCADE,
  "slot_key" varchar(80) NOT NULL,
  "component_resource_id" uuid
    REFERENCES "resources"("id") ON DELETE RESTRICT,
  "quantity_per_assembly" integer,
  "position" integer,
  "note" text DEFAULT '' NOT NULL,
  "removed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "variant_bom_overrides_organization_variant_fk"
    FOREIGN KEY ("organization_id", "variant_resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "variant_bom_overrides_organization_component_fk"
    FOREIGN KEY ("organization_id", "component_resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "variant_bom_overrides_slot_key_check"
    CHECK ("slot_key" ~ '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT "variant_bom_overrides_position_nonnegative"
    CHECK ("position" IS NULL OR "position" >= 0),
  CONSTRAINT "variant_bom_overrides_payload_check"
    CHECK (
      ("removed" AND "component_resource_id" IS NULL AND "quantity_per_assembly" IS NULL)
      OR
      (NOT "removed" AND "component_resource_id" IS NOT NULL
        AND "quantity_per_assembly" > 0 AND "position" IS NOT NULL)
    ),
  CONSTRAINT "variant_bom_overrides_distinct_resources"
    CHECK ("component_resource_id" IS NULL OR "variant_resource_id" <> "component_resource_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "variant_bom_overrides_variant_slot_unique"
  ON "variant_bom_overrides" ("variant_resource_id", "slot_key");
CREATE INDEX IF NOT EXISTS "variant_bom_overrides_variant_idx"
  ON "variant_bom_overrides" ("variant_resource_id");
CREATE INDEX IF NOT EXISTS "variant_bom_overrides_component_idx"
  ON "variant_bom_overrides" ("component_resource_id");

COMMENT ON COLUMN "resource_relations"."attributes" IS
  'Typed relationship attributes. variant_of uses overriddenFields for live catalog inheritance.';
COMMENT ON TABLE "variant_bom_overrides" IS
  'Sparse per-slot BOM removals, replacements, and additions for first-class resource variants.';
