ALTER TABLE "resources"
  ADD COLUMN IF NOT EXISTS "map_features" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "resources"
  DROP CONSTRAINT IF EXISTS "resources_map_features_array";
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_map_features_array"
  CHECK (jsonb_typeof("map_features") = 'array');
