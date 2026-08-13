CREATE TABLE IF NOT EXISTS "public_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "scope" varchar(16) NOT NULL,
  "resource_id" uuid REFERENCES "resources"("id") ON DELETE CASCADE,
  "filter" jsonb,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "public_shares_scope_check"
    CHECK ("scope" IN ('inventory', 'item')),
  CONSTRAINT "public_shares_scope_target_check"
    CHECK (
      ("scope" = 'inventory' AND "resource_id" IS NULL)
      OR
      ("scope" = 'item' AND "resource_id" IS NOT NULL AND "filter" IS NULL)
    ),
  CONSTRAINT "public_shares_filter_object"
    CHECK ("filter" IS NULL OR jsonb_typeof("filter") = 'object'),
  CONSTRAINT "public_shares_filter_shape"
    CHECK (
      "filter" IS NULL OR (
        "filter" ? 'fieldKey'
        AND "filter" ? 'value'
        AND ("filter" - 'fieldKey' - 'value') = '{}'::jsonb
        AND jsonb_typeof("filter" -> 'fieldKey') = 'string'
        AND ("filter" ->> 'fieldKey') ~ '^[a-z][a-z0-9_]{0,63}$'
        AND jsonb_typeof("filter" -> 'value') IN ('string', 'number', 'boolean', 'array')
      )
    )
);

CREATE INDEX IF NOT EXISTS "public_shares_active_created_at_idx"
  ON "public_shares" ("revoked_at", "created_at");
CREATE INDEX IF NOT EXISTS "public_shares_resource_id_idx"
  ON "public_shares" ("resource_id");

COMMENT ON TABLE "public_shares" IS
  'Revocable, UUID-addressed public read capabilities for an item or filtered inventory view.';
