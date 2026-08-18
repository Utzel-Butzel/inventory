-- Option groups add user-facing dimensions to first-class resource families.
-- The primary resource represents the all-default combination; generated
-- variants remain ordinary resources with their own operational data.
CREATE TABLE IF NOT EXISTS "resource_option_groups" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "primary_resource_id" uuid NOT NULL
    REFERENCES "resources"("id") ON DELETE CASCADE,
  "key" varchar(64) NOT NULL,
  "name" varchar(120) NOT NULL,
  "bom_slot_key" varchar(80),
  "position" integer DEFAULT 0 NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_option_groups_organization_primary_fk"
    FOREIGN KEY ("organization_id", "primary_resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "resource_option_groups_key_check"
    CHECK ("key" ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT "resource_option_groups_name_nonempty"
    CHECK (length(btrim("name")) > 0),
  CONSTRAINT "resource_option_groups_bom_slot_check"
    CHECK ("bom_slot_key" IS NULL OR "bom_slot_key" ~ '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT "resource_option_groups_position_nonnegative"
    CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_groups_organization_id_id_unique"
  ON "resource_option_groups" ("organization_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_groups_primary_key_unique"
  ON "resource_option_groups" ("primary_resource_id", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_groups_primary_bom_slot_unique"
  ON "resource_option_groups" ("primary_resource_id", "bom_slot_key")
  WHERE "bom_slot_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "resource_option_groups_primary_position_idx"
  ON "resource_option_groups" ("primary_resource_id", "position");

CREATE TABLE IF NOT EXISTS "resource_option_values" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL
    REFERENCES "resource_option_groups"("id") ON DELETE CASCADE,
  "label" varchar(120) NOT NULL,
  "code" varchar(40) NOT NULL,
  "component_resource_id" uuid
    REFERENCES "resources"("id") ON DELETE RESTRICT,
  "is_default" boolean DEFAULT false NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_option_values_organization_group_fk"
    FOREIGN KEY ("organization_id", "group_id")
    REFERENCES "resource_option_groups"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "resource_option_values_organization_component_fk"
    FOREIGN KEY ("organization_id", "component_resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "resource_option_values_label_nonempty"
    CHECK (length(btrim("label")) > 0),
  CONSTRAINT "resource_option_values_code_check"
    CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  CONSTRAINT "resource_option_values_position_nonnegative"
    CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_values_organization_id_unique"
  ON "resource_option_values" ("organization_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_values_group_id_id_unique"
  ON "resource_option_values" ("group_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_values_group_code_unique"
  ON "resource_option_values" ("group_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_values_group_default_unique"
  ON "resource_option_values" ("group_id") WHERE "is_default";
CREATE INDEX IF NOT EXISTS "resource_option_values_group_position_idx"
  ON "resource_option_values" ("group_id", "position");
CREATE INDEX IF NOT EXISTS "resource_option_values_component_idx"
  ON "resource_option_values" ("component_resource_id");

CREATE TABLE IF NOT EXISTS "resource_option_configurations" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "primary_resource_id" uuid NOT NULL
    REFERENCES "resources"("id") ON DELETE CASCADE,
  "resource_id" uuid NOT NULL
    REFERENCES "resources"("id") ON DELETE CASCADE,
  "signature" varchar(1024) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_option_configurations_organization_primary_fk"
    FOREIGN KEY ("organization_id", "primary_resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "resource_option_configurations_organization_resource_fk"
    FOREIGN KEY ("organization_id", "resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "resource_option_configurations_signature_nonempty"
    CHECK (length("signature") > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_configurations_organization_id_unique"
  ON "resource_option_configurations" ("organization_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_configurations_resource_unique"
  ON "resource_option_configurations" ("organization_id", "resource_id");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_option_configurations_signature_unique"
  ON "resource_option_configurations" ("primary_resource_id", "signature");
CREATE INDEX IF NOT EXISTS "resource_option_configurations_primary_idx"
  ON "resource_option_configurations" ("primary_resource_id");

CREATE TABLE IF NOT EXISTS "resource_option_selections" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "configuration_id" uuid NOT NULL
    REFERENCES "resource_option_configurations"("id") ON DELETE CASCADE,
  "group_id" uuid NOT NULL
    REFERENCES "resource_option_groups"("id") ON DELETE RESTRICT,
  "value_id" uuid NOT NULL
    REFERENCES "resource_option_values"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_option_selections_organization_configuration_fk"
    FOREIGN KEY ("organization_id", "configuration_id")
    REFERENCES "resource_option_configurations"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "resource_option_selections_organization_group_fk"
    FOREIGN KEY ("organization_id", "group_id")
    REFERENCES "resource_option_groups"("organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "resource_option_selections_group_value_fk"
    FOREIGN KEY ("group_id", "value_id")
    REFERENCES "resource_option_values"("group_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "resource_option_selections_pk"
    PRIMARY KEY ("configuration_id", "group_id")
);

CREATE INDEX IF NOT EXISTS "resource_option_selections_value_idx"
  ON "resource_option_selections" ("value_id");

COMMENT ON TABLE "resource_option_groups" IS
  'User-facing dimensions for first-class resource families; an optional stable BOM slot maps values to components.';
COMMENT ON TABLE "resource_option_configurations" IS
  'One materialized option combination per primary or generated first-class resource variant.';
