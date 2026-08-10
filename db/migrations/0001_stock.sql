DO $$
BEGIN
  ALTER TABLE "resources"
    ADD CONSTRAINT "resources_quantity_nonnegative" CHECK ("quantity" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "stock_settings" (
  "resource_id" uuid PRIMARY KEY REFERENCES "resources"("id") ON DELETE CASCADE,
  "tracking_mode" varchar(16) DEFAULT 'bulk' NOT NULL,
  "minimum_stock" integer DEFAULT 0 NOT NULL,
  "reorder_quantity" integer DEFAULT 0 NOT NULL,
  "lead_time_days" integer DEFAULT 0 NOT NULL,
  "unit_name" varchar(80) DEFAULT 'unit' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_settings_tracking_mode_check"
    CHECK ("tracking_mode" IN ('bulk', 'serialized')),
  CONSTRAINT "stock_settings_minimum_nonnegative" CHECK ("minimum_stock" >= 0),
  CONSTRAINT "stock_settings_reorder_nonnegative" CHECK ("reorder_quantity" >= 0),
  CONSTRAINT "stock_settings_lead_time_nonnegative" CHECK ("lead_time_days" >= 0)
);

CREATE TABLE IF NOT EXISTS "stock_units" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "code" varchar(180) NOT NULL,
  "status" varchar(32) DEFAULT 'available' NOT NULL,
  "location" varchar(240),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_moved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_units_status_check"
    CHECK ("status" IN (
      'available', 'reserved', 'in-use', 'maintenance',
      'consumed', 'lost', 'retired'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_units_resource_code_unique"
  ON "stock_units" ("resource_id", "code");
CREATE INDEX IF NOT EXISTS "stock_units_resource_id_idx"
  ON "stock_units" ("resource_id");
CREATE INDEX IF NOT EXISTS "stock_units_resource_status_idx"
  ON "stock_units" ("resource_id", "status");

CREATE TABLE IF NOT EXISTS "stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "unit_id" uuid REFERENCES "stock_units"("id") ON DELETE SET NULL,
  "delta" integer NOT NULL,
  "balance_after" integer NOT NULL,
  "type" varchar(48) DEFAULT 'adjustment' NOT NULL,
  "reason" varchar(240),
  "note" text DEFAULT '' NOT NULL,
  "location" varchar(240),
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" varchar(320),
  CONSTRAINT "stock_movements_balance_nonnegative" CHECK ("balance_after" >= 0)
);

CREATE INDEX IF NOT EXISTS "stock_movements_resource_id_idx"
  ON "stock_movements" ("resource_id");
CREATE INDEX IF NOT EXISTS "stock_movements_resource_occurred_idx"
  ON "stock_movements" ("resource_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "stock_movements_unit_id_idx"
  ON "stock_movements" ("unit_id");

-- Existing inventory starts in bulk mode and receives one immutable opening entry.
INSERT INTO "stock_settings" (
  "resource_id", "tracking_mode", "minimum_stock", "reorder_quantity",
  "lead_time_days", "unit_name", "created_at", "updated_at"
)
SELECT
  "id", 'bulk', 0, 0, 0, 'unit', "created_at", "updated_at"
FROM "resources"
ON CONFLICT ("resource_id") DO NOTHING;

INSERT INTO "stock_movements" (
  "resource_id", "delta", "balance_after", "type", "reason", "note",
  "location", "occurred_at", "created_at", "created_by"
)
SELECT
  resource."id",
  resource."quantity",
  resource."quantity",
  'opening_balance',
  'Opening balance',
  '',
  resource."location",
  resource."created_at",
  resource."created_at",
  resource."created_by"
FROM "resources" AS resource
WHERE NOT EXISTS (
  SELECT 1
  FROM "stock_movements" AS movement
  WHERE movement."resource_id" = resource."id"
    AND movement."type" = 'opening_balance'
);

-- Keep future resources on the same ledger without coupling resource creation to UI code.
CREATE OR REPLACE FUNCTION "initialize_resource_stock"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "stock_settings" (
    "resource_id", "tracking_mode", "minimum_stock", "reorder_quantity",
    "lead_time_days", "unit_name", "created_at", "updated_at"
  ) VALUES (
    NEW."id", 'bulk', 0, 0, 0, 'unit', NEW."created_at", NEW."updated_at"
  ) ON CONFLICT ("resource_id") DO NOTHING;

  INSERT INTO "stock_movements" (
    "resource_id", "delta", "balance_after", "type", "reason", "note",
    "location", "occurred_at", "created_at", "created_by"
  ) VALUES (
    NEW."id", NEW."quantity", NEW."quantity", 'opening_balance',
    'Opening balance', '', NEW."location", NEW."created_at", NEW."created_at",
    NEW."created_by"
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "resources_initialize_stock" ON "resources";
CREATE TRIGGER "resources_initialize_stock"
AFTER INSERT ON "resources"
FOR EACH ROW EXECUTE FUNCTION "initialize_resource_stock"();

COMMENT ON TABLE "stock_movements" IS
  'Append-only stock ledger. Correct historical mistakes with a compensating movement.';
