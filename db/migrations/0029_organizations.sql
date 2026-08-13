-- Adopt every pre-organization installation into one stable organization. The
-- UUID remains the stable home of every legacy row after the backfill.
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(160) NOT NULL,
  "slug" varchar(80) NOT NULL,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organizations_slug_check"
    CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_unique"
  ON "organizations" ("slug");

INSERT INTO "organizations" ("id", "name", "slug", "created_by")
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Inventory',
  'inventory',
  'migration'
)
ON CONFLICT ("id") DO NOTHING;

-- Every organization-owned relation carries the tenant key directly. This is
-- intentionally explicit even for child rows so request predicates and future
-- row-level-security policies can fail closed without depending on joins.
DO $organizations$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'access_roles', 'inventory_access_rules',
    'inventory_type_definitions', 'relation_type_definitions',
    'translation_languages', 'resources', 'resource_variants',
    'resource_translations', 'resource_translation_jobs',
    'spatial_structures', 'spatial_coordinate_spaces', 'room_scans',
    'room_scan_assets', 'room_scan_keyframes',
    'resource_spatial_placements', 'resource_relations',
    'custom_field_definitions', 'label_setups',
    'resource_creation_requests', 'bom_lines', 'assembly_builds',
    'purchase_orders', 'purchase_order_lines', 'purchase_receipts',
    'stock_settings', 'stock_location_balances',
    'inventory_cycle_policies', 'stock_units', 'stock_movements',
    'inventory_counts', 'inventory_assignments',
    'assembly_build_components', 'stock_movement_requests',
    'stock_scan_workflows', 'stock_scan_executions', 'media',
    'public_shares', 'media_upload_batches', 'media_upload_batch_items',
    'ai_idempotency_operations', 'ai_rate_limit_buckets',
    'notification_preferences', 'notification_inbox',
    'notification_dispatches', 'notification_push_subscriptions',
    'webhook_endpoints', 'webhook_events', 'webhook_deliveries',
    'api_tokens'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id uuid',
      relation_name
    );
    EXECUTE format(
      'UPDATE %I SET organization_id = %L WHERE organization_id IS NULL',
      relation_name,
      '00000000-0000-4000-8000-000000000001'
    );
    -- Fail closed after adoption: every new tenant-owned write must name its
    -- organization instead of silently falling into the legacy tenant.
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN organization_id DROP DEFAULT',
      relation_name
    );
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL',
      relation_name
    );
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = relation_name::regclass
        AND conname = relation_name || '_organization_id_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE',
        relation_name,
        relation_name || '_organization_id_fkey'
      );
    END IF;
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)',
      relation_name || '_organization_id_idx',
      relation_name
    );
  END LOOP;
END
$organizations$;

-- Natural configuration keys are reusable in separate organizations.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_access_roles_fk";
ALTER TABLE "inventory_access_rules"
  DROP CONSTRAINT IF EXISTS "inventory_access_rules_role_key_fkey";
ALTER TABLE "resources"
  DROP CONSTRAINT IF EXISTS "resources_type_inventory_type_definitions_fk";
ALTER TABLE "resource_relations"
  DROP CONSTRAINT IF EXISTS "resource_relations_relation_type_key_fkey";
ALTER TABLE "resource_translations"
  DROP CONSTRAINT IF EXISTS "resource_translations_language_code_fkey";
ALTER TABLE "resource_translation_jobs"
  DROP CONSTRAINT IF EXISTS "resource_translation_jobs_language_code_fkey";

ALTER TABLE "access_roles" DROP CONSTRAINT IF EXISTS "access_roles_pkey";
ALTER TABLE "access_roles"
  ADD CONSTRAINT "access_roles_organization_key_pk"
  PRIMARY KEY ("organization_id", "key");

ALTER TABLE "inventory_type_definitions"
  DROP CONSTRAINT IF EXISTS "inventory_type_definitions_pkey";
ALTER TABLE "inventory_type_definitions"
  ADD CONSTRAINT "inventory_type_definitions_organization_key_pk"
  PRIMARY KEY ("organization_id", "key");

ALTER TABLE "relation_type_definitions"
  DROP CONSTRAINT IF EXISTS "relation_type_definitions_pkey";
ALTER TABLE "relation_type_definitions"
  ADD CONSTRAINT "relation_type_definitions_organization_key_pk"
  PRIMARY KEY ("organization_id", "key");

ALTER TABLE "translation_languages"
  DROP CONSTRAINT IF EXISTS "translation_languages_pkey";
ALTER TABLE "translation_languages"
  ADD CONSTRAINT "translation_languages_organization_code_pk"
  PRIMARY KEY ("organization_id", "code");

ALTER TABLE "inventory_access_rules"
  ADD CONSTRAINT "inventory_access_rules_role_fk"
  FOREIGN KEY ("organization_id", "role_key")
  REFERENCES "access_roles" ("organization_id", "key")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce tenant/parent consistency on high-volume resource children and the
-- durable webhook queue. The existing single-column FKs still provide their
-- historical cascade behavior; these composite FKs reject mismatched tenants.
CREATE UNIQUE INDEX "resources_organization_id_id_unique"
  ON "resources" ("organization_id", "id");
ALTER TABLE "resource_variants"
  ADD CONSTRAINT "resource_variants_organization_resource_fk"
  FOREIGN KEY ("organization_id", "resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "bom_lines"
  ADD CONSTRAINT "bom_lines_organization_assembly_fk"
  FOREIGN KEY ("organization_id", "assembly_resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "bom_lines"
  ADD CONSTRAINT "bom_lines_organization_component_fk"
  FOREIGN KEY ("organization_id", "component_resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_settings"
  ADD CONSTRAINT "stock_settings_organization_resource_fk"
  FOREIGN KEY ("organization_id", "resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "stock_location_balances"
  ADD CONSTRAINT "stock_location_balances_organization_resource_fk"
  FOREIGN KEY ("organization_id", "resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "stock_location_balances"
  ADD CONSTRAINT "stock_location_balances_organization_location_fk"
  FOREIGN KEY ("organization_id", "location_resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE RESTRICT;
ALTER TABLE "inventory_cycle_policies"
  ADD CONSTRAINT "inventory_cycle_policies_organization_resource_fk"
  FOREIGN KEY ("organization_id", "resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "stock_units_organization_id_id_unique"
  ON "stock_units" ("organization_id", "id");
ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_organization_resource_fk"
  FOREIGN KEY ("organization_id", "resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_organization_resource_fk"
  FOREIGN KEY ("organization_id", "resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "media"
  ADD CONSTRAINT "media_organization_resource_fk"
  FOREIGN KEY ("organization_id", "resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "room_scans_organization_id_id_unique"
  ON "room_scans" ("organization_id", "id");
ALTER TABLE "room_scans"
  ADD CONSTRAINT "room_scans_organization_resource_fk"
  FOREIGN KEY ("organization_id", "room_resource_id")
  REFERENCES "resources" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "room_scan_assets"
  ADD CONSTRAINT "room_scan_assets_organization_scan_fk"
  FOREIGN KEY ("organization_id", "room_scan_id")
  REFERENCES "room_scans" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "room_scan_keyframes"
  ADD CONSTRAINT "room_scan_keyframes_organization_scan_fk"
  FOREIGN KEY ("organization_id", "room_scan_id")
  REFERENCES "room_scans" ("organization_id", "id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "webhook_endpoints_organization_id_id_unique"
  ON "webhook_endpoints" ("organization_id", "id");
CREATE UNIQUE INDEX "webhook_events_organization_id_id_unique"
  ON "webhook_events" ("organization_id", "id");
ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_organization_endpoint_fk"
  FOREIGN KEY ("organization_id", "webhook_id")
  REFERENCES "webhook_endpoints" ("organization_id", "id") ON DELETE RESTRICT;
ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_organization_event_fk"
  FOREIGN KEY ("organization_id", "event_id")
  REFERENCES "webhook_events" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_inventory_type_fk"
  FOREIGN KEY ("organization_id", "type")
  REFERENCES "inventory_type_definitions" ("organization_id", "key")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_relations"
  ADD CONSTRAINT "resource_relations_relation_type_fk"
  FOREIGN KEY ("organization_id", "relation_type_key")
  REFERENCES "relation_type_definitions" ("organization_id", "key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resource_translations"
  DROP CONSTRAINT IF EXISTS "resource_translations_pk";
ALTER TABLE "resource_translations"
  ADD CONSTRAINT "resource_translations_pk"
  PRIMARY KEY ("organization_id", "resource_id", "language_code");
ALTER TABLE "resource_translations"
  ADD CONSTRAINT "resource_translations_language_fk"
  FOREIGN KEY ("organization_id", "language_code")
  REFERENCES "translation_languages" ("organization_id", "code")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resource_translation_jobs"
  DROP CONSTRAINT IF EXISTS "resource_translation_jobs_pk";
ALTER TABLE "resource_translation_jobs"
  ADD CONSTRAINT "resource_translation_jobs_pk"
  PRIMARY KEY ("organization_id", "resource_id", "language_code");
ALTER TABLE "resource_translation_jobs"
  ADD CONSTRAINT "resource_translation_jobs_language_fk"
  FOREIGN KEY ("organization_id", "language_code")
  REFERENCES "translation_languages" ("organization_id", "code")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Membership role assignment, rather than users.role, is authoritative.
CREATE TABLE IF NOT EXISTS "organization_memberships" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role_key" varchar(64) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organization_memberships_organization_user_pk"
    PRIMARY KEY ("organization_id", "user_id"),
  CONSTRAINT "organization_memberships_role_fk"
    FOREIGN KEY ("organization_id", "role_key")
    REFERENCES "access_roles" ("organization_id", "key")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "organization_memberships_user_active_idx"
  ON "organization_memberships" ("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "organization_memberships_role_idx"
  ON "organization_memberships" ("organization_id", "role_key");

INSERT INTO "organization_memberships" (
  "organization_id", "user_id", "role_key", "is_active", "created_by"
)
SELECT
  '00000000-0000-4000-8000-000000000001', "id", "role", "is_active", 'migration'
FROM "users"
ON CONFLICT ("organization_id", "user_id") DO NOTHING;

-- Scope externally meaningful identifiers and replay keys. UUID primary keys
-- remain globally unique; organization_id is nevertheless required in reads.
DROP INDEX IF EXISTS "resources_sku_unique";
CREATE UNIQUE INDEX "resources_sku_unique"
  ON "resources" ("organization_id", "sku") WHERE "sku" IS NOT NULL;
DROP INDEX IF EXISTS "resources_barcode_unique";
CREATE UNIQUE INDEX "resources_barcode_unique"
  ON "resources" ("organization_id", "barcode") WHERE "barcode" IS NOT NULL;
DROP INDEX IF EXISTS "resource_variants_sku_unique";
CREATE UNIQUE INDEX "resource_variants_sku_unique"
  ON "resource_variants" ("organization_id", "sku") WHERE "sku" IS NOT NULL;
DROP INDEX IF EXISTS "resource_variants_barcode_unique";
CREATE UNIQUE INDEX "resource_variants_barcode_unique"
  ON "resource_variants" ("organization_id", "barcode") WHERE "barcode" IS NOT NULL;
DROP INDEX IF EXISTS "translation_languages_one_active_default";
CREATE UNIQUE INDEX "translation_languages_one_active_default"
  ON "translation_languages" ("organization_id", "is_default")
  WHERE "archived_at" IS NULL AND "is_default" = true;
DROP INDEX IF EXISTS "custom_field_definitions_entity_key_unique";
CREATE UNIQUE INDEX "custom_field_definitions_entity_key_unique"
  ON "custom_field_definitions" ("organization_id", "entity_type", "key");
DROP INDEX IF EXISTS "label_setups_name_unique";
CREATE UNIQUE INDEX "label_setups_name_unique"
  ON "label_setups" ("organization_id", lower("name"));

ALTER TABLE "resource_creation_requests"
  DROP CONSTRAINT IF EXISTS "resource_creation_requests_pkey";
ALTER TABLE "resource_creation_requests"
  ADD CONSTRAINT "resource_creation_requests_pk"
  PRIMARY KEY ("organization_id", "idempotency_key");
ALTER TABLE "resource_creation_requests"
  DROP CONSTRAINT IF EXISTS "resource_creation_requests_resource_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "resource_creation_requests_resource_id_unique"
  ON "resource_creation_requests" ("organization_id", "resource_id");

ALTER TABLE "stock_movement_requests"
  DROP CONSTRAINT IF EXISTS "stock_movement_requests_pkey";
ALTER TABLE "stock_movement_requests"
  ADD CONSTRAINT "stock_movement_requests_pk"
  PRIMARY KEY ("organization_id", "idempotency_key");

DROP INDEX IF EXISTS "assembly_builds_idempotency_key_unique";
CREATE UNIQUE INDEX "assembly_builds_idempotency_key_unique"
  ON "assembly_builds" ("organization_id", "idempotency_key");
DROP INDEX IF EXISTS "purchase_orders_idempotency_key_unique";
CREATE UNIQUE INDEX "purchase_orders_idempotency_key_unique"
  ON "purchase_orders" ("organization_id", "idempotency_key");
DROP INDEX IF EXISTS "purchase_receipts_idempotency_key_unique";
CREATE UNIQUE INDEX "purchase_receipts_idempotency_key_unique"
  ON "purchase_receipts" ("organization_id", "idempotency_key");
DROP INDEX IF EXISTS "inventory_counts_idempotency_key_unique";
CREATE UNIQUE INDEX "inventory_counts_idempotency_key_unique"
  ON "inventory_counts" ("organization_id", "idempotency_key");
DROP INDEX IF EXISTS "stock_scan_executions_idempotency_key_unique";
CREATE UNIQUE INDEX "stock_scan_executions_idempotency_key_unique"
  ON "stock_scan_executions" ("organization_id", "idempotency_key");
ALTER TABLE "media_upload_batches"
  DROP CONSTRAINT IF EXISTS "media_upload_batches_idempotency_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "media_upload_batches_idempotency_key_unique"
  ON "media_upload_batches" ("organization_id", "idempotency_key");
DROP INDEX IF EXISTS "ai_idempotency_operations_operation_key_unique";
CREATE UNIQUE INDEX "ai_idempotency_operations_operation_key_unique"
  ON "ai_idempotency_operations" ("organization_id", "operation", "idempotency_key");

ALTER TABLE "ai_rate_limit_buckets"
  DROP CONSTRAINT IF EXISTS "ai_rate_limit_buckets_operation_subject_pk";
ALTER TABLE "ai_rate_limit_buckets"
  ADD CONSTRAINT "ai_rate_limit_buckets_operation_subject_pk"
  PRIMARY KEY ("organization_id", "operation", "subject_hash");

-- Notification identities and endpoint hashes may legitimately repeat between
-- organizations. Their child foreign keys include the same tenant key.
ALTER TABLE "notification_inbox"
  DROP CONSTRAINT IF EXISTS "notification_inbox_recipient_key_fkey";
ALTER TABLE "notification_dispatches"
  DROP CONSTRAINT IF EXISTS "notification_dispatches_recipient_key_fkey";
ALTER TABLE "notification_push_subscriptions"
  DROP CONSTRAINT IF EXISTS "notification_push_subscriptions_recipient_key_fkey";
ALTER TABLE "notification_preferences"
  DROP CONSTRAINT IF EXISTS "notification_preferences_pkey";
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_organization_recipient_pk"
  PRIMARY KEY ("organization_id", "recipient_key");
ALTER TABLE "notification_inbox"
  ADD CONSTRAINT "notification_inbox_preference_fk"
  FOREIGN KEY ("organization_id", "recipient_key")
  REFERENCES "notification_preferences" ("organization_id", "recipient_key")
  ON DELETE CASCADE;
ALTER TABLE "notification_dispatches"
  ADD CONSTRAINT "notification_dispatches_preference_fk"
  FOREIGN KEY ("organization_id", "recipient_key")
  REFERENCES "notification_preferences" ("organization_id", "recipient_key")
  ON DELETE CASCADE;
ALTER TABLE "notification_push_subscriptions"
  ADD CONSTRAINT "notification_push_subscriptions_preference_fk"
  FOREIGN KEY ("organization_id", "recipient_key")
  REFERENCES "notification_preferences" ("organization_id", "recipient_key")
  ON DELETE CASCADE;

DROP INDEX IF EXISTS "notification_inbox_dedupe_unique";
CREATE UNIQUE INDEX "notification_inbox_dedupe_unique"
  ON "notification_inbox" (
    "organization_id", "recipient_key", "event_type", "source_key", "dedupe_bucket"
  );
DROP INDEX IF EXISTS "notification_dispatches_dedupe_unique";
CREATE UNIQUE INDEX "notification_dispatches_dedupe_unique"
  ON "notification_dispatches" ("organization_id", "dedupe_key");
DROP INDEX IF EXISTS "notification_push_subscriptions_endpoint_unique";
CREATE UNIQUE INDEX "notification_push_subscriptions_endpoint_unique"
  ON "notification_push_subscriptions" ("organization_id", "endpoint_hash");

COMMENT ON TABLE "organizations" IS
  'Security and data-isolation boundary for inventory records and settings.';
COMMENT ON COLUMN "api_tokens"."organization_id" IS
  'Fallback organization for user-bound tokens and immutable tenant for standalone tokens.';

-- The stock initializer predates tenancy and writes child rows from a resource
-- trigger. Propagate the resource tenant explicitly now that defaults fail
-- closed.
CREATE OR REPLACE FUNCTION "initialize_resource_stock"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "stock_settings" (
    "organization_id", "resource_id", "tracking_mode", "minimum_stock",
    "reorder_quantity", "lead_time_days", "unit_name", "created_at", "updated_at"
  ) VALUES (
    NEW."organization_id", NEW."id", 'bulk', 0, 0, 0, 'unit',
    NEW."created_at", NEW."updated_at"
  ) ON CONFLICT ("resource_id") DO NOTHING;

  INSERT INTO "stock_movements" (
    "organization_id", "resource_id", "delta", "balance_after", "type",
    "reason", "note", "location", "occurred_at", "created_at", "created_by"
  ) VALUES (
    NEW."organization_id", NEW."id", NEW."quantity", NEW."quantity",
    'opening_balance', 'Opening balance', '', NEW."location", NEW."created_at",
    NEW."created_at", NEW."created_by"
  );

  RETURN NEW;
END;
$$;

-- Translation triggers predate tenancy. Keep their public function signatures
-- for application compatibility, derive the tenant from the resource, and
-- constrain every language/job/read-modify-write operation to that tenant.
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
DECLARE
  target_organization_id uuid;
BEGIN
  SELECT "organization_id"
  INTO target_organization_id
  FROM "resources"
  WHERE "id" = target_resource_id;

  IF target_organization_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "resource_translation_jobs" (
    "organization_id", "resource_id", "language_code", "source_revision",
    "mode", "force", "status", "attempts", "run_after", "requested_by"
  ) VALUES (
    target_organization_id,
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
  ON CONFLICT ("organization_id", "resource_id", "language_code") DO UPDATE SET
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
  WHERE "organization_id" = target_organization_id
    AND "resource_id" = target_resource_id
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
  target_organization_id uuid;
  language_row record;
BEGIN
  SELECT "organization_id"
  INTO target_organization_id
  FROM "resources"
  WHERE "id" = target_resource_id;

  FOR language_row IN
    SELECT "code"
    FROM "translation_languages"
    WHERE "organization_id" = target_organization_id
      AND "archived_at" IS NULL
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

CREATE OR REPLACE FUNCTION "queue_resource_translations_after_media_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_resource_id uuid;
  target_organization_id uuid;
  next_revision integer;
BEGIN
  target_resource_id =
    CASE WHEN TG_OP = 'DELETE' THEN OLD."resource_id" ELSE NEW."resource_id" END;
  target_organization_id =
    CASE WHEN TG_OP = 'DELETE' THEN OLD."organization_id" ELSE NEW."organization_id" END;

  UPDATE "resources"
  SET "content_revision" = "content_revision" + 1
  WHERE "organization_id" = target_organization_id
    AND "id" = target_resource_id
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

CREATE OR REPLACE FUNCTION "queue_translations_after_language_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resource_row record;
  should_force boolean;
BEGIN
  IF NEW."archived_at" IS NOT NULL OR NEW."is_default" OR NOT NEW."auto_translate" THEN
    DELETE FROM "resource_translation_jobs"
    WHERE "organization_id" = NEW."organization_id"
      AND "language_code" = NEW."code";
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
    FOR resource_row IN
      SELECT "id", "content_revision"
      FROM "resources"
      WHERE "organization_id" = NEW."organization_id"
    LOOP
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

CREATE OR REPLACE FUNCTION "queue_translations_after_custom_field_definition_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affects_inventory_text boolean;
  target_organization_id uuid;
  resource_row record;
  language_row record;
BEGIN
  target_organization_id =
    CASE WHEN TG_OP = 'DELETE' THEN OLD."organization_id" ELSE NEW."organization_id" END;

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
    WHERE "organization_id" = target_organization_id
      AND "archived_at" IS NULL
      AND "is_default" = false
      AND "auto_translate" = true
  LOOP
    FOR resource_row IN
      SELECT "id", "content_revision"
      FROM "resources"
      WHERE "organization_id" = target_organization_id
    LOOP
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
