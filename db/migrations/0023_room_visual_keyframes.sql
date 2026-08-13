ALTER TABLE "room_scan_assets"
  DROP CONSTRAINT IF EXISTS "room_scan_assets_kind_check";
ALTER TABLE "room_scan_assets"
  ADD CONSTRAINT "room_scan_assets_kind_check"
  CHECK ("kind" IN (
    'world_map',
    'model_usdz',
    'structure_model',
    'guide_image',
    'textured_mesh',
    'gaussian_splat'
  ));

CREATE TABLE IF NOT EXISTS "room_scan_keyframes" (
  "id" uuid PRIMARY KEY NOT NULL,
  "room_scan_id" uuid NOT NULL REFERENCES "room_scans"("id") ON DELETE CASCADE,
  "captured_at" timestamp with time zone NOT NULL,
  "frame_timestamp" double precision NOT NULL,
  "camera_transform" jsonb NOT NULL,
  "intrinsics" jsonb NOT NULL,
  "image_width" integer NOT NULL,
  "image_height" integer NOT NULL,
  "orientation" varchar(24) NOT NULL,
  "quality" double precision NOT NULL,
  "feature_descriptor" jsonb,
  "storage_key" text NOT NULL,
  "storage_url" text NOT NULL,
  "name" varchar(280) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "size" integer NOT NULL,
  "checksum_sha256" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "room_scan_keyframes_timestamp_nonnegative"
    CHECK ("frame_timestamp" >= 0),
  CONSTRAINT "room_scan_keyframes_dimensions_range"
    CHECK ("image_width" BETWEEN 1 AND 4096 AND "image_height" BETWEEN 1 AND 4096),
  CONSTRAINT "room_scan_keyframes_orientation_check"
    CHECK ("orientation" IN (
      'up', 'up-mirrored', 'down', 'down-mirrored',
      'left-mirrored', 'right', 'right-mirrored', 'left'
    )),
  CONSTRAINT "room_scan_keyframes_quality_range"
    CHECK ("quality" BETWEEN 0 AND 1),
  CONSTRAINT "room_scan_keyframes_camera_transform_array"
    CHECK (jsonb_typeof("camera_transform") = 'array' AND jsonb_array_length("camera_transform") = 16),
  CONSTRAINT "room_scan_keyframes_intrinsics_array"
    CHECK (jsonb_typeof("intrinsics") = 'array' AND jsonb_array_length("intrinsics") = 9),
  CONSTRAINT "room_scan_keyframes_size_positive" CHECK ("size" > 0)
);

CREATE INDEX IF NOT EXISTS "room_scan_keyframes_scan_time_idx"
  ON "room_scan_keyframes" ("room_scan_id", "frame_timestamp");

ALTER TABLE "resource_spatial_placements"
  ADD COLUMN IF NOT EXISTS "localization_evidence" jsonb;
ALTER TABLE "resource_spatial_placements"
  DROP CONSTRAINT IF EXISTS "resource_spatial_placements_localization_evidence_object";
ALTER TABLE "resource_spatial_placements"
  ADD CONSTRAINT "resource_spatial_placements_localization_evidence_object"
  CHECK (
    "localization_evidence" IS NULL OR
    jsonb_typeof("localization_evidence") = 'object'
  );

COMMENT ON TABLE "room_scan_keyframes" IS
  'Bounded RGB camera frames with ARKit camera calibration and poses in the room scan coordinate space.';
COMMENT ON COLUMN "resource_spatial_placements"."localization_evidence" IS
  'Optional visual-keyframe match evidence supporting the saved indoor placement.';
