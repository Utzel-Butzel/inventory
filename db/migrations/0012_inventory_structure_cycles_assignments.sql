CREATE TABLE IF NOT EXISTS "inventory_type_definitions" (
  "key" varchar(64) PRIMARY KEY NOT NULL,
  "label" varchar(120) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "color" varchar(32) DEFAULT '#635bff' NOT NULL,
  "icon" varchar(80) DEFAULT 'box' NOT NULL,
  "can_contain" boolean DEFAULT false NOT NULL,
  "spatial_containment" boolean DEFAULT false NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "inventory_type_definitions_key_check"
    CHECK ("key" ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT "inventory_type_definitions_position_nonnegative"
    CHECK ("position" >= 0)
);

CREATE INDEX IF NOT EXISTS "inventory_type_definitions_active_position_idx"
  ON "inventory_type_definitions" ("archived_at", "position");

INSERT INTO "inventory_type_definitions"
  ("key", "label", "description", "color", "icon", "can_contain", "spatial_containment", "position", "is_system")
VALUES
  ('place', 'Place / room', 'A site, building, room, zone, shelf, or other place.', '#16a374', 'map-pin', true, true, 10, true),
  ('furniture', 'Furniture', 'Furniture and fixtures which may contain other items.', '#b9875e', 'armchair', true, true, 20, true),
  ('vehicle', 'Vehicle', 'Vehicles and mobile containers.', '#3b82f6', 'car', true, true, 30, true),
  ('tool', 'Tool', 'Tools and workshop equipment.', '#e99b2d', 'wrench', false, false, 40, true),
  ('object', 'Object', 'General physical objects and stock items.', '#635bff', 'box', false, false, 50, true),
  ('clothing', 'Clothing', 'Clothing and wearable equipment.', '#e2647f', 'shirt', false, false, 60, true),
  ('person', 'Person', 'A person represented inside the inventory graph.', '#a66dd4', 'user', false, false, 70, true),
  ('project', 'Project', 'A project or logical collection.', '#64748b', 'folder', true, false, 80, true),
  ('other', 'Other', 'Fallback type for records which do not fit another type.', '#858b95', 'shapes', false, false, 90, true)
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "relation_type_definitions" (
  "key" varchar(64) PRIMARY KEY NOT NULL,
  "label" varchar(120) NOT NULL,
  "inverse_label" varchar(120) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "allow_manual" boolean DEFAULT true NOT NULL,
  "spatial" boolean DEFAULT false NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "relation_type_definitions_key_check"
    CHECK ("key" ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT "relation_type_definitions_position_nonnegative"
    CHECK ("position" >= 0)
);

CREATE INDEX IF NOT EXISTS "relation_type_definitions_active_position_idx"
  ON "relation_type_definitions" ("archived_at", "position");

INSERT INTO "relation_type_definitions"
  ("key", "label", "inverse_label", "description", "allow_manual", "spatial", "position", "is_system")
VALUES
  ('contains', 'Contains', 'Located in', 'Physical or logical containment. Spatial edges are recalculated from map geometry.', true, true, 10, true),
  ('related', 'Related to', 'Related to', 'A general relationship without containment semantics.', true, false, 20, true)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "resources" ALTER COLUMN "type" TYPE varchar(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'resources_type_inventory_type_definitions_fk'
  ) THEN
    ALTER TABLE "resources"
      ADD CONSTRAINT "resources_type_inventory_type_definitions_fk"
      FOREIGN KEY ("type") REFERENCES "inventory_type_definitions"("key")
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "resource_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "target_resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "relation_type_key" varchar(64) NOT NULL REFERENCES "relation_type_definitions"("key") ON UPDATE CASCADE ON DELETE RESTRICT,
  "origin" varchar(16) DEFAULT 'manual' NOT NULL,
  "source_feature_id" varchar(80),
  "target_feature_id" varchar(80),
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_relations_distinct_resources"
    CHECK ("source_resource_id" <> "target_resource_id"),
  CONSTRAINT "resource_relations_origin_check"
    CHECK ("origin" IN ('manual', 'spatial'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "resource_relations_edge_unique"
  ON "resource_relations" ("source_resource_id", "target_resource_id", "relation_type_key");
CREATE INDEX IF NOT EXISTS "resource_relations_source_idx"
  ON "resource_relations" ("source_resource_id", "relation_type_key");
CREATE INDEX IF NOT EXISTS "resource_relations_target_idx"
  ON "resource_relations" ("target_resource_id", "relation_type_key");

INSERT INTO "resource_relations"
  ("source_resource_id", "target_resource_id", "relation_type_key", "origin", "created_by")
SELECT resource."id", related."id", 'related', 'manual', resource."created_by"
FROM "resources" resource
CROSS JOIN LATERAL unnest(resource."related_resource_ids") AS related_id
JOIN "resources" related ON related."id" = related_id
WHERE resource."id" <> related."id"
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "stock_location_balances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "location_resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE RESTRICT,
  "quantity" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_location_balances_nonnegative" CHECK ("quantity" >= 0),
  CONSTRAINT "stock_location_balances_distinct_resources" CHECK ("resource_id" <> "location_resource_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_location_balances_resource_location_unique"
  ON "stock_location_balances" ("resource_id", "location_resource_id");
CREATE INDEX IF NOT EXISTS "stock_location_balances_location_idx"
  ON "stock_location_balances" ("location_resource_id");

CREATE TABLE IF NOT EXISTS "inventory_cycle_policies" (
  "resource_id" uuid PRIMARY KEY NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "interval_days" integer NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "next_due_at" timestamp with time zone NOT NULL,
  "last_completed_at" timestamp with time zone,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_cycle_policies_interval_check" CHECK ("interval_days" BETWEEN 1 AND 3650)
);

CREATE INDEX IF NOT EXISTS "inventory_cycle_policies_due_idx"
  ON "inventory_cycle_policies" ("enabled", "next_due_at");

ALTER TABLE "stock_units"
  ADD COLUMN IF NOT EXISTS "location_resource_id" uuid REFERENCES "resources"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "stock_units_location_resource_idx"
  ON "stock_units" ("location_resource_id");

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "from_location_resource_id" uuid REFERENCES "resources"("id") ON DELETE SET NULL;
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "to_location_resource_id" uuid REFERENCES "resources"("id") ON DELETE SET NULL;
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 0 NOT NULL;
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "from_location_balance_after" integer;
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "to_location_balance_after" integer;
UPDATE "stock_movements" SET "quantity" = abs("delta") WHERE "quantity" = 0 AND "delta" <> 0;
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_from_location_balance_nonnegative"
    CHECK ("from_location_balance_after" IS NULL OR "from_location_balance_after" >= 0);
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_to_location_balance_nonnegative"
    CHECK ("to_location_balance_after" IS NULL OR "to_location_balance_after" >= 0);
CREATE INDEX IF NOT EXISTS "stock_movements_from_location_idx"
  ON "stock_movements" ("from_location_resource_id");
CREATE INDEX IF NOT EXISTS "stock_movements_to_location_idx"
  ON "stock_movements" ("to_location_resource_id");

CREATE TABLE IF NOT EXISTS "inventory_counts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE RESTRICT,
  "location_resource_id" uuid REFERENCES "resources"("id") ON DELETE SET NULL,
  "expected_quantity" integer NOT NULL,
  "counted_quantity" integer NOT NULL,
  "variance" integer NOT NULL,
  "counted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "movement_id" uuid REFERENCES "stock_movements"("id") ON DELETE SET NULL,
  "idempotency_key" uuid,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_counts_expected_nonnegative" CHECK ("expected_quantity" >= 0),
  CONSTRAINT "inventory_counts_counted_nonnegative" CHECK ("counted_quantity" >= 0),
  CONSTRAINT "inventory_counts_variance_consistent" CHECK ("variance" = "counted_quantity" - "expected_quantity")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_counts_idempotency_key_unique"
  ON "inventory_counts" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "inventory_counts_resource_counted_idx"
  ON "inventory_counts" ("resource_id", "counted_at");
CREATE INDEX IF NOT EXISTS "inventory_counts_location_idx"
  ON "inventory_counts" ("location_resource_id");

CREATE TABLE IF NOT EXISTS "inventory_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE RESTRICT,
  "stock_unit_id" uuid REFERENCES "stock_units"("id") ON DELETE RESTRICT,
  "kind" varchar(24) NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "assignee_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "assignee_resource_id" uuid REFERENCES "resources"("id") ON DELETE SET NULL,
  "assignee_label" varchar(240) DEFAULT '' NOT NULL,
  "starts_at" timestamp with time zone DEFAULT now() NOT NULL,
  "due_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "note" text DEFAULT '' NOT NULL,
  "created_by" varchar(320),
  "completed_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_assignments_kind_check" CHECK ("kind" IN ('checkout', 'assignment', 'reservation')),
  CONSTRAINT "inventory_assignments_status_check" CHECK ("status" IN ('active', 'returned', 'cancelled')),
  CONSTRAINT "inventory_assignments_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_assignments_serialized_quantity_one" CHECK ("stock_unit_id" IS NULL OR "quantity" = 1),
  CONSTRAINT "inventory_assignments_exactly_one_assignee"
    CHECK (num_nonnulls("assignee_user_id", "assignee_resource_id", nullif("assignee_label", '')) = 1)
);

CREATE INDEX IF NOT EXISTS "inventory_assignments_resource_status_idx"
  ON "inventory_assignments" ("resource_id", "status");
CREATE INDEX IF NOT EXISTS "inventory_assignments_due_idx"
  ON "inventory_assignments" ("status", "due_at");
CREATE INDEX IF NOT EXISTS "inventory_assignments_stock_unit_idx"
  ON "inventory_assignments" ("stock_unit_id");
CREATE INDEX IF NOT EXISTS "inventory_assignments_assignee_user_idx"
  ON "inventory_assignments" ("assignee_user_id");
CREATE INDEX IF NOT EXISTS "inventory_assignments_assignee_resource_idx"
  ON "inventory_assignments" ("assignee_resource_id");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_assignments_active_stock_unit_unique"
  ON "inventory_assignments" ("stock_unit_id")
  WHERE "stock_unit_id" IS NOT NULL AND "status" = 'active';

COMMENT ON TABLE "resource_relations" IS
  'Directed, typed relationships between inventory resources. Contains edges point from container to contained item.';
COMMENT ON TABLE "stock_location_balances" IS
  'Per-location bulk stock. Locations are regular inventory resources.';
COMMENT ON TABLE "inventory_cycle_policies" IS
  'Recurring count schedules for inventory resources.';
COMMENT ON TABLE "inventory_assignments" IS
  'Checkout, assignment, and reservation records for bulk or serialized inventory.';
