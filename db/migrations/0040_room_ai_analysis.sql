ALTER TABLE "room_scans"
  ADD COLUMN IF NOT EXISTS "ai_analysis" jsonb;

ALTER TABLE "room_scans"
  DROP CONSTRAINT IF EXISTS "room_scans_ai_analysis_object";
ALTER TABLE "room_scans"
  ADD CONSTRAINT "room_scans_ai_analysis_object"
  CHECK (
    "ai_analysis" IS NULL
    OR jsonb_typeof("ai_analysis") = 'object'
  );

COMMENT ON COLUMN "room_scans"."ai_analysis" IS
  'Reviewed OpenAI vision output for dominant room finishes and inventory-worthy object suggestions.';
