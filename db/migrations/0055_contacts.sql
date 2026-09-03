CREATE TABLE IF NOT EXISTS "contacts" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(240) NOT NULL,
  "company" varchar(240),
  "roles" text[] NOT NULL,
  "email" varchar(320),
  "phone" varchar(80),
  "website" varchar(2048),
  "customer_number" varchar(80),
  "supplier_number" varchar(80),
  "tax_id" varchar(80),
  "address_line_1" varchar(240),
  "address_line_2" varchar(240),
  "postal_code" varchar(32),
  "city" varchar(120),
  "state" varchar(120),
  "country_code" varchar(2),
  "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "archived_at" timestamp with time zone,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contacts_name_nonempty"
    CHECK (length(btrim("name")) > 0),
  CONSTRAINT "contacts_roles_check"
    CHECK (
      cardinality("roles") > 0
      AND "roles" <@ ARRAY['customer', 'supplier']::text[]
    ),
  CONSTRAINT "contacts_country_code_check"
    CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_organization_id_id_unique"
  ON "contacts" ("organization_id", "id");
CREATE INDEX IF NOT EXISTS "contacts_organization_name_idx"
  ON "contacts" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "contacts_organization_archived_idx"
  ON "contacts" ("organization_id", "archived_at");

CREATE TABLE IF NOT EXISTS "contact_resources" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL,
  "resource_id" uuid NOT NULL,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_resources_organization_contact_resource_pk"
    PRIMARY KEY ("organization_id", "contact_id", "resource_id"),
  CONSTRAINT "contact_resources_organization_contact_fk"
    FOREIGN KEY ("organization_id", "contact_id")
    REFERENCES "contacts"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "contact_resources_organization_resource_fk"
    FOREIGN KEY ("organization_id", "resource_id")
    REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "contact_resources_resource_idx"
  ON "contact_resources" ("organization_id", "resource_id");

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "contact_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_movements_organization_contact_fk'
  ) THEN
    ALTER TABLE "stock_movements"
      ADD CONSTRAINT "stock_movements_organization_contact_fk"
      FOREIGN KEY ("organization_id", "contact_id")
      REFERENCES "contacts"("organization_id", "id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "stock_movements_contact_id_idx"
  ON "stock_movements" ("organization_id", "contact_id");

UPDATE "access_roles"
SET "permissions" = array_append("permissions", 'contacts.read'),
    "updated_at" = now()
WHERE "is_system" = true
  AND "key" IN ('admin', 'editor', 'viewer')
  AND NOT ('contacts.read' = ANY("permissions"));

UPDATE "access_roles"
SET "permissions" = array_append("permissions", 'contacts.manage'),
    "updated_at" = now()
WHERE "is_system" = true
  AND "key" IN ('admin', 'editor')
  AND NOT ('contacts.manage' = ANY("permissions"));

COMMENT ON TABLE "contacts" IS
  'Organization-scoped customers and suppliers, including dual-role contacts.';
COMMENT ON TABLE "contact_resources" IS
  'Many-to-many assignments between contacts and inventory resources.';
COMMENT ON COLUMN "stock_movements"."contact_id" IS
  'Optional customer or supplier associated with this stock movement.';
