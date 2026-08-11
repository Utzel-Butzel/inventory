ALTER TABLE "resources"
  ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE "resources"
  ADD CONSTRAINT "resources_custom_fields_object"
  CHECK (jsonb_typeof("custom_fields") = 'object');

ALTER TABLE "stock_units"
  ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_custom_fields_object"
  CHECK (jsonb_typeof("custom_fields") = 'object');

CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" varchar(24) NOT NULL,
  "key" varchar(64) NOT NULL,
  "label" varchar(120) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "placeholder" varchar(240) DEFAULT '' NOT NULL,
  "field_type" varchar(24) NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "min_value" double precision,
  "max_value" double precision,
  "step" double precision,
  "resource_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "options" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "custom_field_definitions_entity_type_check"
    CHECK ("entity_type" IN ('inventory', 'stock_unit')),
  CONSTRAINT "custom_field_definitions_field_type_check"
    CHECK ("field_type" IN (
      'text', 'textarea', 'number', 'boolean', 'date', 'datetime',
      'select', 'multi_select', 'email', 'url'
    )),
  CONSTRAINT "custom_field_definitions_key_check"
    CHECK ("key" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "custom_field_definitions_resource_types_array"
    CHECK (jsonb_typeof("resource_types") = 'array'),
  CONSTRAINT "custom_field_definitions_categories_array"
    CHECK (jsonb_typeof("categories") = 'array'),
  CONSTRAINT "custom_field_definitions_options_array"
    CHECK (jsonb_typeof("options") = 'array'),
  CONSTRAINT "custom_field_definitions_position_nonnegative"
    CHECK ("position" >= 0),
  CONSTRAINT "custom_field_definitions_revision_positive"
    CHECK ("revision" > 0),
  CONSTRAINT "custom_field_definitions_range_check"
    CHECK ("min_value" IS NULL OR "max_value" IS NULL OR "min_value" <= "max_value"),
  CONSTRAINT "custom_field_definitions_step_positive"
    CHECK ("step" IS NULL OR "step" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_definitions_entity_key_unique"
  ON "custom_field_definitions" ("entity_type", "key");
CREATE INDEX IF NOT EXISTS "custom_field_definitions_entity_active_position_idx"
  ON "custom_field_definitions" ("entity_type", "archived_at", "position");

COMMENT ON COLUMN "stock_units"."metadata" IS
  'Legacy and integration metadata. Configured fields are stored separately in custom_fields.';
COMMENT ON TABLE "custom_field_definitions" IS
  'Typed, configurable field definitions for inventory resources and serialized stock units.';
