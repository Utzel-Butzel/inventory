CREATE TABLE IF NOT EXISTS "room_scans" (
  "id" uuid PRIMARY KEY NOT NULL,
  "room_resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "scene" jsonb NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  "device_model" varchar(120),
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "room_scans_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "room_scans_status_check" CHECK ("status" IN ('active', 'superseded')),
  CONSTRAINT "room_scans_scene_object" CHECK (jsonb_typeof("scene") = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS "room_scans_room_revision_unique"
  ON "room_scans" ("room_resource_id", "revision");
CREATE UNIQUE INDEX IF NOT EXISTS "room_scans_one_active_per_room"
  ON "room_scans" ("room_resource_id") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "room_scans_room_status_idx"
  ON "room_scans" ("room_resource_id", "status");
CREATE INDEX IF NOT EXISTS "room_scans_captured_at_idx"
  ON "room_scans" ("captured_at");

CREATE TABLE IF NOT EXISTS "room_scan_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_scan_id" uuid NOT NULL REFERENCES "room_scans"("id") ON DELETE CASCADE,
  "kind" varchar(24) NOT NULL,
  "storage_key" text NOT NULL,
  "storage_url" text NOT NULL,
  "name" varchar(280) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "size" integer NOT NULL,
  "checksum_sha256" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "room_scan_assets_kind_check"
    CHECK ("kind" IN ('world_map', 'model_usdz', 'guide_image')),
  CONSTRAINT "room_scan_assets_size_nonnegative" CHECK ("size" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "room_scan_assets_scan_kind_unique"
  ON "room_scan_assets" ("room_scan_id", "kind");
CREATE INDEX IF NOT EXISTS "room_scan_assets_scan_idx"
  ON "room_scan_assets" ("room_scan_id");

CREATE TABLE IF NOT EXISTS "resource_spatial_placements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "room_scan_id" uuid NOT NULL REFERENCES "room_scans"("id") ON DELETE CASCADE,
  "position_x" double precision NOT NULL,
  "position_y" double precision NOT NULL,
  "position_z" double precision NOT NULL,
  "quaternion_x" double precision DEFAULT 0 NOT NULL,
  "quaternion_y" double precision DEFAULT 0 NOT NULL,
  "quaternion_z" double precision DEFAULT 0 NOT NULL,
  "quaternion_w" double precision DEFAULT 1 NOT NULL,
  "extent_x" double precision,
  "extent_y" double precision,
  "extent_z" double precision,
  "confidence" double precision NOT NULL,
  "method" varchar(24) NOT NULL,
  "anchor_identifier" uuid,
  "captured_at" timestamp with time zone NOT NULL,
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_spatial_placements_method_check"
    CHECK ("method" IN ('scene-depth', 'mesh-raycast', 'plane-raycast', 'manual')),
  CONSTRAINT "resource_spatial_placements_confidence_range"
    CHECK ("confidence" BETWEEN 0 AND 1),
  CONSTRAINT "resource_spatial_placements_quaternion_normalized"
    CHECK (abs((("quaternion_x" * "quaternion_x") +
      ("quaternion_y" * "quaternion_y") +
      ("quaternion_z" * "quaternion_z") +
      ("quaternion_w" * "quaternion_w")) - 1) < 0.1),
  CONSTRAINT "resource_spatial_placements_extent_nonnegative"
    CHECK (("extent_x" IS NULL OR "extent_x" BETWEEN 0 AND 100) AND
      ("extent_y" IS NULL OR "extent_y" BETWEEN 0 AND 100) AND
      ("extent_z" IS NULL OR "extent_z" BETWEEN 0 AND 100))
);

CREATE UNIQUE INDEX IF NOT EXISTS "resource_spatial_placements_resource_unique"
  ON "resource_spatial_placements" ("resource_id");
CREATE INDEX IF NOT EXISTS "resource_spatial_placements_scan_idx"
  ON "resource_spatial_placements" ("room_scan_id");

COMMENT ON TABLE "room_scans" IS
  'Versioned RoomPlan scenes whose transforms share the archived ARKit world coordinate frame.';
COMMENT ON TABLE "room_scan_assets" IS
  'Native AR world maps, original USDZ models, and optional relocalization guide images.';
COMMENT ON TABLE "resource_spatial_placements" IS
  'The current indoor 3D placement of an inventory resource in a particular room scan.';
