ALTER TABLE "room_scans"
  ADD COLUMN IF NOT EXISTS "layout_transform" jsonb;

ALTER TABLE "room_scans"
  DROP CONSTRAINT IF EXISTS "room_scans_layout_transform_array";
ALTER TABLE "room_scans"
  ADD CONSTRAINT "room_scans_layout_transform_array"
  CHECK (
    "layout_transform" IS NULL OR (
      jsonb_typeof("layout_transform") = 'array' AND
      jsonb_array_length("layout_transform") = 16
    )
  );

COMMENT ON COLUMN "room_scans"."layout_transform" IS
  'Optional column-major structure-from-model transform used to align independently captured rooms on one floor.';
