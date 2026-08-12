CREATE TABLE IF NOT EXISTS "spatial_structures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(240) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "georeference" jsonb,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "spatial_structures_georeference_object"
    CHECK ("georeference" IS NULL OR jsonb_typeof("georeference") = 'object')
);

CREATE INDEX IF NOT EXISTS "spatial_structures_name_idx"
  ON "spatial_structures" ("name");
CREATE INDEX IF NOT EXISTS "spatial_structures_updated_at_idx"
  ON "spatial_structures" ("updated_at");

CREATE TABLE IF NOT EXISTS "spatial_coordinate_spaces" (
  "id" uuid PRIMARY KEY NOT NULL,
  "structure_id" uuid NOT NULL REFERENCES "spatial_structures"("id") ON DELETE CASCADE,
  "georeference" jsonb,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "spatial_coordinate_spaces_georeference_object"
    CHECK ("georeference" IS NULL OR jsonb_typeof("georeference") = 'object')
);

CREATE INDEX IF NOT EXISTS "spatial_coordinate_spaces_structure_idx"
  ON "spatial_coordinate_spaces" ("structure_id");

ALTER TABLE "room_scans"
  ADD COLUMN IF NOT EXISTS "structure_id" uuid,
  ADD COLUMN IF NOT EXISTS "coordinate_space_id" uuid,
  ADD COLUMN IF NOT EXISTS "floor_identifier" varchar(120),
  ADD COLUMN IF NOT EXISTS "floor_index" integer,
  ADD COLUMN IF NOT EXISTS "room_identifier" varchar(120);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'room_scans_structure_id_spatial_structures_id_fk'
      AND conrelid = 'room_scans'::regclass
  ) THEN
    ALTER TABLE "room_scans"
      ADD CONSTRAINT "room_scans_structure_id_spatial_structures_id_fk"
      FOREIGN KEY ("structure_id") REFERENCES "spatial_structures"("id")
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'room_scans_coordinate_space_id_spatial_coordinate_spaces_id_fk'
      AND conrelid = 'room_scans'::regclass
  ) THEN
    ALTER TABLE "room_scans"
      ADD CONSTRAINT "room_scans_coordinate_space_id_spatial_coordinate_spaces_id_fk"
      FOREIGN KEY ("coordinate_space_id") REFERENCES "spatial_coordinate_spaces"("id")
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'room_scans_coordinate_space_requires_structure'
      AND conrelid = 'room_scans'::regclass
  ) THEN
    ALTER TABLE "room_scans"
      ADD CONSTRAINT "room_scans_coordinate_space_requires_structure"
      CHECK ("coordinate_space_id" IS NULL OR "structure_id" IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "room_scans_structure_status_idx"
  ON "room_scans" ("structure_id", "status");
CREATE INDEX IF NOT EXISTS "room_scans_coordinate_space_idx"
  ON "room_scans" ("coordinate_space_id");
CREATE INDEX IF NOT EXISTS "room_scans_structure_floor_idx"
  ON "room_scans" ("structure_id", "floor_index", "floor_identifier");

ALTER TABLE "room_scan_assets"
  DROP CONSTRAINT IF EXISTS "room_scan_assets_kind_check";
ALTER TABLE "room_scan_assets"
  ADD CONSTRAINT "room_scan_assets_kind_check"
  CHECK ("kind" IN ('world_map', 'model_usdz', 'structure_model', 'guide_image'));

COMMENT ON TABLE "spatial_structures" IS
  'Buildings or sites containing RoomPlan rooms grouped into floors.';
COMMENT ON TABLE "spatial_coordinate_spaces" IS
  'Shared ARKit world frames. Only scans with the same id may be spatially overlaid.';
COMMENT ON COLUMN "spatial_coordinate_spaces"."georeference" IS
  'Geographic anchor for this AR world frame; heading is local -Z clockwise from true north.';
COMMENT ON COLUMN "room_scans"."coordinate_space_id" IS
  'Identifies scans captured or relocalized in one compatible ARKit world coordinate frame.';
