CREATE TABLE IF NOT EXISTS "access_roles" (
  "key" varchar(64) PRIMARY KEY NOT NULL,
  "name" varchar(120) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "permissions" text[] DEFAULT '{}' NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "access_roles_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_-]{0,63}$')
);

INSERT INTO "access_roles" (
  "key", "name", "description", "permissions", "is_system", "created_by", "updated_by"
) VALUES
  (
    'admin',
    'Admin',
    'Full workspace access, including users, roles, settings, and API tokens.',
    ARRAY[
      'inventory.read','inventory.create','inventory.update','inventory.delete','inventory.import','inventory.export',
      'stock.read','stock.manage','assignments.read','assignments.manage','counts.read','counts.manage',
      'spatial.read','spatial.manage','orders.read','orders.manage','workflows.read','workflows.manage',
      'labels.read','labels.manage','ai.use','settings.inventory-types.manage','settings.custom-fields.manage',
      'settings.languages.manage','users.manage','roles.manage','sharing.manage','tokens.manage','tokens.delegate'
    ],
    true,
    'migration',
    'migration'
  ),
  (
    'editor',
    'Editor',
    'Can work with inventory and operational workflows, without workspace administration.',
    ARRAY[
      'inventory.read','inventory.create','inventory.update','inventory.delete','inventory.import','inventory.export',
      'stock.read','stock.manage','assignments.read','assignments.manage','counts.read','counts.manage',
      'spatial.read','spatial.manage','orders.read','orders.manage','workflows.read','workflows.manage',
      'labels.read','labels.manage','ai.use'
    ],
    true,
    'migration',
    'migration'
  ),
  (
    'viewer',
    'Viewer',
    'Read-only access to inventory and operational records.',
    ARRAY[
      'inventory.read','stock.read','assignments.read','counts.read','spatial.read','orders.read','workflows.read','labels.read'
    ],
    true,
    'migration',
    'migration'
  )
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
ALTER TABLE "users" ALTER COLUMN "role" TYPE varchar(64);
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_access_roles_fk"
  FOREIGN KEY ("role") REFERENCES "access_roles"("key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "inventory_access_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "role_key" varchar(64) NOT NULL REFERENCES "access_roles"("key") ON DELETE CASCADE ON UPDATE CASCADE,
  "permissions" text[] DEFAULT '{}' NOT NULL,
  "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_access_rules_permissions_nonempty" CHECK (cardinality("permissions") > 0),
  CONSTRAINT "inventory_access_rules_conditions_array" CHECK (
    jsonb_typeof("conditions") = 'array' AND jsonb_array_length("conditions") > 0
  ),
  CONSTRAINT "inventory_access_rules_priority_nonnegative" CHECK ("priority" >= 0)
);

CREATE INDEX IF NOT EXISTS "inventory_access_rules_role_enabled_idx"
  ON "inventory_access_rules" ("role_key", "enabled", "priority");

COMMENT ON TABLE "inventory_access_rules" IS
  'Additive grants for resource-level actions. Every condition in a rule must match the current resource.';
