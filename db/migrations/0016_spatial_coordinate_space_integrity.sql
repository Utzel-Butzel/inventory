CREATE UNIQUE INDEX IF NOT EXISTS
  "spatial_coordinate_spaces_id_structure_unique"
  ON "spatial_coordinate_spaces" ("id", "structure_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "room_scans" AS scan
    LEFT JOIN "spatial_coordinate_spaces" AS coordinate_space
      ON coordinate_space."id" = scan."coordinate_space_id"
    WHERE scan."coordinate_space_id" IS NOT NULL
      AND (
        scan."structure_id" IS NULL
        OR coordinate_space."id" IS NULL
        OR coordinate_space."structure_id" IS DISTINCT FROM scan."structure_id"
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce room scan coordinate-space ownership: inconsistent existing rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'room_scans_coordinate_space_structure_fk'
      AND conrelid = 'room_scans'::regclass
  ) THEN
    ALTER TABLE "room_scans"
      ADD CONSTRAINT "room_scans_coordinate_space_structure_fk"
      FOREIGN KEY ("coordinate_space_id", "structure_id")
      REFERENCES "spatial_coordinate_spaces" ("id", "structure_id")
      MATCH SIMPLE
      ON DELETE SET NULL ("coordinate_space_id")
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE "room_scans"
  VALIDATE CONSTRAINT "room_scans_coordinate_space_structure_fk";

ALTER TABLE "room_scans"
  DROP CONSTRAINT IF EXISTS
    "room_scans_coordinate_space_id_spatial_coordinate_spaces_id_fk";

COMMENT ON CONSTRAINT "room_scans_coordinate_space_structure_fk"
  ON "room_scans" IS
  'Ensures each room scan coordinate space belongs to the scan structure; MATCH SIMPLE keeps structure-only legacy scans valid.';
