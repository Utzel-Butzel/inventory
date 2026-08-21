CREATE TABLE IF NOT EXISTS "resource_slugs" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "slug" varchar(80) NOT NULL,
  "resource_id" uuid NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_slugs_organization_slug_pk"
    PRIMARY KEY ("organization_id", "slug"),
  CONSTRAINT "resource_slugs_organization_resource_fk"
    FOREIGN KEY ("organization_id", "resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "resource_slugs_slug_check" CHECK (
    "slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND "slug" <> 'new'
    AND "slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT "resource_slugs_position_nonnegative" CHECK ("position" >= 0)
);

CREATE INDEX IF NOT EXISTS "resource_slugs_resource_position_idx"
  ON "resource_slugs" ("organization_id", "resource_id", "position");

COMMENT ON TABLE "resource_slugs" IS
  'Organization-scoped, user-managed URL aliases for inventory resources.';
