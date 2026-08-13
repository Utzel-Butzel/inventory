CREATE TABLE IF NOT EXISTS "translation_languages" (
  "code" varchar(35) PRIMARY KEY NOT NULL,
  "label" varchar(120) NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "auto_translate" boolean DEFAULT true NOT NULL,
  "instructions" text DEFAULT '' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "translation_languages_code_check"
    CHECK ("code" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CONSTRAINT "translation_languages_position_nonnegative"
    CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "translation_languages_one_active_default"
  ON "translation_languages" ("is_default")
  WHERE "archived_at" IS NULL AND "is_default" = true;
CREATE INDEX IF NOT EXISTS "translation_languages_active_position_idx"
  ON "translation_languages" ("archived_at", "position");

ALTER TABLE "resources"
  ADD COLUMN IF NOT EXISTS "content_revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "resources"
  DROP CONSTRAINT IF EXISTS "resources_content_revision_positive";
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_content_revision_positive"
  CHECK ("content_revision" > 0);

-- This table supersedes the first field-row prototype. One resource/locale
-- document is the atomic persistence boundary; individual hashes still make
-- freshness and fallback field-specific.

CREATE TABLE IF NOT EXISTS "resource_translations" (
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "language_code" varchar(35) NOT NULL
    REFERENCES "translation_languages"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "translated_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "manual_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "suggested_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "suggestion_source_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "policy_hash" varchar(64) DEFAULT '' NOT NULL,
  "status" varchar(24) DEFAULT 'stale' NOT NULL,
  "model" varchar(120),
  "last_error" text,
  "revision" integer DEFAULT 1 NOT NULL,
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_translations_pk"
    PRIMARY KEY ("resource_id", "language_code"),
  CONSTRAINT "resource_translations_translated_fields_object"
    CHECK (jsonb_typeof("translated_fields") = 'object'),
  CONSTRAINT "resource_translations_source_hashes_object"
    CHECK (jsonb_typeof("source_hashes") = 'object'),
  CONSTRAINT "resource_translations_suggested_fields_object"
    CHECK (jsonb_typeof("suggested_fields") = 'object'),
  CONSTRAINT "resource_translations_suggestion_hashes_object"
    CHECK (jsonb_typeof("suggestion_source_hashes") = 'object'),
  CONSTRAINT "resource_translations_policy_hash_check"
    CHECK ("policy_hash" = '' OR "policy_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "resource_translations_status_check"
    CHECK ("status" IN ('current', 'stale', 'needs_review', 'failed')),
  CONSTRAINT "resource_translations_revision_positive"
    CHECK ("revision" > 0)
);

CREATE INDEX IF NOT EXISTS "resource_translations_language_idx"
  ON "resource_translations" ("language_code");

-- Preserve installations that briefly used the field-row prototype. AI rows
-- are intentionally marked policy-stale and will be refreshed; manual values
-- and their source hashes remain protected.
DO $$
BEGIN
  IF to_regclass('public.resource_field_translations') IS NOT NULL THEN
    EXECUTE $migration$
      INSERT INTO "resource_translations" (
        "resource_id",
        "language_code",
        "translated_fields",
        "source_hashes",
        "manual_fields",
        "status",
        "model",
        "updated_by",
        "created_at",
        "updated_at"
      )
      SELECT
        "resource_id",
        "language_code",
        jsonb_object_agg("field_key", "translated_text"),
        jsonb_object_agg("field_key", "source_hash"),
        COALESCE(
          array_agg("field_key" ORDER BY "field_key")
            FILTER (WHERE "origin" = 'manual'),
          ARRAY[]::text[]
        ),
        'stale',
        max("model"),
        max("updated_by"),
        min("created_at"),
        max("updated_at")
      FROM "resource_field_translations"
      GROUP BY "resource_id", "language_code"
      ON CONFLICT ("resource_id", "language_code") DO NOTHING
    $migration$;
    EXECUTE 'DROP TABLE "resource_field_translations"';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "resource_translation_jobs" (
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "language_code" varchar(35) NOT NULL
    REFERENCES "translation_languages"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "generation" integer DEFAULT 1 NOT NULL,
  "source_revision" integer DEFAULT 1 NOT NULL,
  "request_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "mode" varchar(16) DEFAULT 'automatic' NOT NULL,
  "force" boolean DEFAULT false NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "run_after" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "requested_by" varchar(320) DEFAULT 'system:translation' NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_translation_jobs_pk"
    PRIMARY KEY ("resource_id", "language_code"),
  CONSTRAINT "resource_translation_jobs_generation_positive"
    CHECK ("generation" > 0),
  CONSTRAINT "resource_translation_jobs_source_revision_positive"
    CHECK ("source_revision" > 0),
  CONSTRAINT "resource_translation_jobs_mode_check"
    CHECK ("mode" IN ('automatic', 'manual')),
  CONSTRAINT "resource_translation_jobs_status_check"
    CHECK ("status" IN ('pending', 'processing', 'failed')),
  CONSTRAINT "resource_translation_jobs_attempts_nonnegative"
    CHECK ("attempts" >= 0)
);

CREATE INDEX IF NOT EXISTS "resource_translation_jobs_due_idx"
  ON "resource_translation_jobs" ("status", "run_after");
CREATE INDEX IF NOT EXISTS "resource_translation_jobs_lease_idx"
  ON "resource_translation_jobs" ("lease_expires_at");

-- One stable database entry point is shared by write triggers and explicit
-- regeneration APIs. A new generation invalidates an in-flight worker and
-- pushes execution out briefly, coalescing rapid successive edits.
CREATE OR REPLACE FUNCTION "enqueue_resource_translation_job"(
  target_resource_id uuid,
  target_language_code varchar,
  target_source_revision integer,
  target_requested_by varchar,
  target_force boolean DEFAULT false,
  target_mode varchar DEFAULT 'automatic'
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "resource_translation_jobs" (
    "resource_id", "language_code", "source_revision", "mode", "force",
    "status", "attempts", "run_after", "requested_by"
  ) VALUES (
    target_resource_id,
    target_language_code,
    target_source_revision,
    target_mode,
    target_force,
    'pending',
    0,
    clock_timestamp() + INTERVAL '2 seconds',
    COALESCE(NULLIF(target_requested_by, ''), 'system:translation')
  )
  ON CONFLICT ("resource_id", "language_code") DO UPDATE SET
    "generation" = "resource_translation_jobs"."generation" + 1,
    "source_revision" = EXCLUDED."source_revision",
    "request_id" = gen_random_uuid(),
    "mode" = EXCLUDED."mode",
    "force" = EXCLUDED."force",
    "status" = 'pending',
    "attempts" = 0,
    "run_after" = EXCLUDED."run_after",
    "lease_token" = NULL,
    "lease_expires_at" = NULL,
    "requested_by" = EXCLUDED."requested_by",
    "last_error" = NULL,
    "updated_at" = clock_timestamp();

  UPDATE "resource_translations"
  SET "status" = CASE
        WHEN "status" = 'needs_review' THEN 'needs_review'
        ELSE 'stale'
      END,
      "last_error" = NULL,
      "updated_at" = clock_timestamp()
  WHERE "resource_id" = target_resource_id
    AND "language_code" = target_language_code;
END;
$$;

CREATE OR REPLACE FUNCTION "enqueue_automatic_resource_translations"(
  target_resource_id uuid,
  target_source_revision integer,
  target_requested_by varchar
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  language_row record;
BEGIN
  FOR language_row IN
    SELECT "code"
    FROM "translation_languages"
    WHERE "archived_at" IS NULL
      AND "is_default" = false
      AND "auto_translate" = true
  LOOP
    PERFORM "enqueue_resource_translation_job"(
      target_resource_id,
      language_row."code",
      target_source_revision,
      target_requested_by,
      false,
      'automatic'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_resource_content_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."content_revision" = OLD."content_revision" + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "resources_bump_content_revision" ON "resources";
CREATE TRIGGER "resources_bump_content_revision"
BEFORE UPDATE OF "name", "description", "notes", "custom_fields", "type", "categories"
ON "resources"
FOR EACH ROW
WHEN (
  OLD."name" IS DISTINCT FROM NEW."name"
  OR OLD."description" IS DISTINCT FROM NEW."description"
  OR OLD."notes" IS DISTINCT FROM NEW."notes"
  OR OLD."custom_fields" IS DISTINCT FROM NEW."custom_fields"
  OR OLD."type" IS DISTINCT FROM NEW."type"
  OR OLD."categories" IS DISTINCT FROM NEW."categories"
)
EXECUTE FUNCTION "bump_resource_content_revision"();

CREATE OR REPLACE FUNCTION "queue_resource_translations_after_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "enqueue_automatic_resource_translations"(
    NEW."id",
    NEW."content_revision",
    COALESCE(NEW."created_by", 'system:resource-change')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "resources_enqueue_translations_insert" ON "resources";
CREATE TRIGGER "resources_enqueue_translations_insert"
AFTER INSERT ON "resources"
FOR EACH ROW EXECUTE FUNCTION "queue_resource_translations_after_write"();

DROP TRIGGER IF EXISTS "resources_enqueue_translations_update" ON "resources";
CREATE TRIGGER "resources_enqueue_translations_update"
AFTER UPDATE OF "name", "description", "notes", "custom_fields", "type", "categories"
ON "resources"
FOR EACH ROW
WHEN (
  OLD."name" IS DISTINCT FROM NEW."name"
  OR OLD."description" IS DISTINCT FROM NEW."description"
  OR OLD."notes" IS DISTINCT FROM NEW."notes"
  OR OLD."custom_fields" IS DISTINCT FROM NEW."custom_fields"
  OR OLD."type" IS DISTINCT FROM NEW."type"
  OR OLD."categories" IS DISTINCT FROM NEW."categories"
)
EXECUTE FUNCTION "queue_resource_translations_after_write"();

-- Alt text is user-facing narrative content but lives outside resources. Its
-- trigger bumps only the dedicated content revision, not general updated_at.
CREATE OR REPLACE FUNCTION "queue_resource_translations_after_media_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_resource_id uuid;
  next_revision integer;
BEGIN
  target_resource_id = CASE WHEN TG_OP = 'DELETE' THEN OLD."resource_id" ELSE NEW."resource_id" END;
  UPDATE "resources"
  SET "content_revision" = "content_revision" + 1
  WHERE "id" = target_resource_id
  RETURNING "content_revision" INTO next_revision;

  IF next_revision IS NOT NULL THEN
    PERFORM "enqueue_automatic_resource_translations"(
      target_resource_id,
      next_revision,
      'system:media-change'
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS "media_enqueue_translations_insert" ON "media";
CREATE TRIGGER "media_enqueue_translations_insert"
AFTER INSERT ON "media"
FOR EACH ROW EXECUTE FUNCTION "queue_resource_translations_after_media_write"();

DROP TRIGGER IF EXISTS "media_enqueue_translations_update" ON "media";
CREATE TRIGGER "media_enqueue_translations_update"
AFTER UPDATE OF "alt_text" ON "media"
FOR EACH ROW
WHEN (OLD."alt_text" IS DISTINCT FROM NEW."alt_text")
EXECUTE FUNCTION "queue_resource_translations_after_media_write"();

DROP TRIGGER IF EXISTS "media_enqueue_translations_delete" ON "media";
CREATE TRIGGER "media_enqueue_translations_delete"
AFTER DELETE ON "media"
FOR EACH ROW EXECUTE FUNCTION "queue_resource_translations_after_media_write"();

-- New automatic languages backfill existing resources. Guidance changes force
-- AI-managed fields through the queue; manual fields remain protected.
CREATE OR REPLACE FUNCTION "queue_translations_after_language_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resource_row record;
  should_force boolean;
BEGIN
  IF NEW."archived_at" IS NOT NULL OR NEW."is_default" OR NOT NEW."auto_translate" THEN
    DELETE FROM "resource_translation_jobs" WHERE "language_code" = NEW."code";
    RETURN NEW;
  END IF;

  should_force = TG_OP = 'UPDATE' AND (
    OLD."label" IS DISTINCT FROM NEW."label"
    OR OLD."instructions" IS DISTINCT FROM NEW."instructions"
  );

  IF TG_OP = 'INSERT'
    OR OLD."archived_at" IS NOT NULL
    OR OLD."is_default"
    OR NOT OLD."auto_translate"
    OR should_force
  THEN
    FOR resource_row IN SELECT "id", "content_revision" FROM "resources" LOOP
      PERFORM "enqueue_resource_translation_job"(
        resource_row."id",
        NEW."code",
        resource_row."content_revision",
        COALESCE(NEW."updated_by", NEW."created_by", 'system:language-change'),
        should_force,
        'automatic'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "translation_languages_enqueue_jobs" ON "translation_languages";
CREATE TRIGGER "translation_languages_enqueue_jobs"
AFTER INSERT OR UPDATE OF "label", "instructions", "auto_translate", "is_default", "archived_at"
ON "translation_languages"
FOR EACH ROW EXECUTE FUNCTION "queue_translations_after_language_write"();

-- Applicability, labels, and descriptions of text fields are part of the safe
-- translation context. Definition changes are rare, so a complete automatic
-- requeue is preferable to leaving an apparently current but policy-stale row.
CREATE OR REPLACE FUNCTION "queue_translations_after_custom_field_definition_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affects_inventory_text boolean;
  resource_row record;
  language_row record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    affects_inventory_text = NEW."entity_type" = 'inventory'
      AND NEW."field_type" IN ('text', 'textarea');
  ELSIF TG_OP = 'DELETE' THEN
    affects_inventory_text = OLD."entity_type" = 'inventory'
      AND OLD."field_type" IN ('text', 'textarea');
  ELSE
    affects_inventory_text = (
      NEW."entity_type" = 'inventory'
      AND NEW."field_type" IN ('text', 'textarea')
    ) OR (
      OLD."entity_type" = 'inventory'
      AND OLD."field_type" IN ('text', 'textarea')
    );
  END IF;

  IF NOT affects_inventory_text THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  FOR language_row IN
    SELECT "code"
    FROM "translation_languages"
    WHERE "archived_at" IS NULL
      AND "is_default" = false
      AND "auto_translate" = true
  LOOP
    FOR resource_row IN SELECT "id", "content_revision" FROM "resources" LOOP
      PERFORM "enqueue_resource_translation_job"(
        resource_row."id",
        language_row."code",
        resource_row."content_revision",
        'system:custom-field-definition',
        true,
        'automatic'
      );
    END LOOP;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS "custom_field_definitions_enqueue_translations"
  ON "custom_field_definitions";
CREATE TRIGGER "custom_field_definitions_enqueue_translations"
AFTER INSERT OR UPDATE OR DELETE ON "custom_field_definitions"
FOR EACH ROW
EXECUTE FUNCTION "queue_translations_after_custom_field_definition_write"();

INSERT INTO "translation_languages" (
  "code", "label", "is_default", "auto_translate", "position", "created_by", "updated_by"
)
VALUES ('en', 'English', true, false, 0, 'system:migration', 'system:migration')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "ai_rate_limit_buckets"
  DROP CONSTRAINT IF EXISTS "ai_rate_limit_buckets_operation_check";
ALTER TABLE "ai_rate_limit_buckets"
  ADD CONSTRAINT "ai_rate_limit_buckets_operation_check"
  CHECK ("operation" IN ('analyze', 'count', 'cover', 'translate'));

ALTER TABLE "ai_idempotency_operations"
  DROP CONSTRAINT IF EXISTS "ai_idempotency_operations_operation_check";
ALTER TABLE "ai_idempotency_operations"
  ADD CONSTRAINT "ai_idempotency_operations_operation_check"
  CHECK ("operation" IN ('analyze', 'count', 'cover', 'translate'));
