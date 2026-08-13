ALTER TABLE "custom_field_definitions"
  ADD COLUMN IF NOT EXISTS "reference_entity_type" varchar(24),
  ADD COLUMN IF NOT EXISTS "reference_multiple" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "reference_resource_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "reference_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "reference_statuses" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "custom_field_definitions"
  DROP CONSTRAINT IF EXISTS "custom_field_definitions_field_type_check";
ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_field_type_check"
  CHECK ("field_type" IN (
    'text', 'textarea', 'number', 'boolean', 'date', 'datetime',
    'select', 'multi_select', 'reference', 'email', 'url'
  ));

ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_reference_entity_type_check"
  CHECK ("reference_entity_type" IS NULL OR "reference_entity_type" IN ('inventory', 'stock_unit')),
  ADD CONSTRAINT "custom_field_definitions_reference_resource_types_array"
  CHECK (jsonb_typeof("reference_resource_types") = 'array'),
  ADD CONSTRAINT "custom_field_definitions_reference_categories_array"
  CHECK (jsonb_typeof("reference_categories") = 'array'),
  ADD CONSTRAINT "custom_field_definitions_reference_statuses_array"
  CHECK (jsonb_typeof("reference_statuses") = 'array'),
  ADD CONSTRAINT "custom_field_definitions_reference_configuration_check"
  CHECK (
    (
      "field_type" = 'reference'
      AND "reference_entity_type" IS NOT NULL
    ) OR (
      "field_type" <> 'reference'
      AND "reference_entity_type" IS NULL
      AND "reference_multiple" = false
      AND "reference_resource_types" = '[]'::jsonb
      AND "reference_categories" = '[]'::jsonb
      AND "reference_statuses" = '[]'::jsonb
    )
  );

COMMENT ON COLUMN "custom_field_definitions"."reference_entity_type" IS
  'Target collection for reference fields. Values store stable resource or stock-unit UUIDs.';
