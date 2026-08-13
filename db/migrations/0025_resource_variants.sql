CREATE TABLE IF NOT EXISTS "resource_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL
    REFERENCES "resources"("id") ON DELETE CASCADE,
  "name" varchar(240) NOT NULL,
  "sku" varchar(80),
  "barcode" varchar(180),
  "price_cents" integer,
  "currency" varchar(3) DEFAULT 'EUR' NOT NULL,
  "quantity" integer DEFAULT 0 NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_variants_name_nonempty"
    CHECK (length(btrim("name")) > 0),
  CONSTRAINT "resource_variants_price_nonnegative"
    CHECK ("price_cents" IS NULL OR "price_cents" >= 0),
  CONSTRAINT "resource_variants_quantity_nonnegative"
    CHECK ("quantity" >= 0),
  CONSTRAINT "resource_variants_position_nonnegative"
    CHECK ("position" >= 0),
  CONSTRAINT "resource_variants_currency_format"
    CHECK ("currency" ~ '^[A-Z]{3}$')
);

ALTER TABLE "resources"
  ADD COLUMN IF NOT EXISTS "barcode" varchar(180);

CREATE UNIQUE INDEX IF NOT EXISTS "resources_barcode_unique"
  ON "resources" ("barcode")
  WHERE "barcode" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "resource_variants_resource_position_idx"
  ON "resource_variants" ("resource_id", "position");

CREATE UNIQUE INDEX IF NOT EXISTS "resource_variants_resource_name_unique"
  ON "resource_variants" ("resource_id", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "resource_variants_id_resource_unique"
  ON "resource_variants" ("id", "resource_id");

CREATE UNIQUE INDEX IF NOT EXISTS "resource_variants_sku_unique"
  ON "resource_variants" ("sku")
  WHERE "sku" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "resource_variants_barcode_unique"
  ON "resource_variants" ("barcode")
  WHERE "barcode" IS NOT NULL;

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "variant_id" uuid,
  ADD COLUMN IF NOT EXISTS "variant_delta" integer,
  ADD COLUMN IF NOT EXISTS "variant_balance_after" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_movements_variant_resource_fk'
  ) THEN
    ALTER TABLE "stock_movements"
      ADD CONSTRAINT "stock_movements_variant_resource_fk"
      FOREIGN KEY ("variant_id", "resource_id")
      REFERENCES "resource_variants"("id", "resource_id")
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "stock_movements_variant_id_idx"
  ON "stock_movements" ("variant_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_movements_variant_balance_nonnegative'
  ) THEN
    ALTER TABLE "stock_movements"
      ADD CONSTRAINT "stock_movements_variant_balance_nonnegative"
      CHECK ("variant_balance_after" IS NULL OR "variant_balance_after" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_movements_variant_fields_consistent'
  ) THEN
    ALTER TABLE "stock_movements"
      ADD CONSTRAINT "stock_movements_variant_fields_consistent"
      CHECK (
        ("variant_id" IS NULL AND "variant_delta" IS NULL AND "variant_balance_after" IS NULL)
        OR
        ("variant_id" IS NOT NULL AND "variant_delta" IS NOT NULL AND "variant_balance_after" IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON TABLE "resource_variants" IS
  'Optional bulk-stock choices for a resource. The parent resource quantity stays canonical; variant quantities allocate part of that total.';

COMMENT ON COLUMN "stock_movements"."variant_delta" IS
  'Change to the linked variant balance. It can differ from the parent delta for allocation-only movements.';
