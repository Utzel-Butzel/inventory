CREATE TABLE IF NOT EXISTS "resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(240) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "type" varchar(32) DEFAULT 'object' NOT NULL,
  "status" varchar(32) DEFAULT 'available' NOT NULL,
  "sku" varchar(80),
  "quantity" integer DEFAULT 1 NOT NULL,
  "location" varchar(240),
  "serial_number" varchar(180),
  "value_cents" integer,
  "currency" varchar(3) DEFAULT 'EUR' NOT NULL,
  "priority" integer DEFAULT 3 NOT NULL,
  "tags" text[] DEFAULT '{}' NOT NULL,
  "categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_resource_ids" uuid[] DEFAULT '{}' NOT NULL,
  "gps_latitude" double precision,
  "gps_longitude" double precision,
  "gps_altitude" double precision,
  "notes" text DEFAULT '' NOT NULL,
  "ai_metadata" jsonb,
  "created_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "resources_sku_unique" ON "resources" ("sku") WHERE "sku" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "resources_name_idx" ON "resources" ("name");
CREATE INDEX IF NOT EXISTS "resources_type_idx" ON "resources" ("type");
CREATE INDEX IF NOT EXISTS "resources_status_idx" ON "resources" ("status");
CREATE INDEX IF NOT EXISTS "resources_updated_at_idx" ON "resources" ("updated_at");

CREATE TABLE IF NOT EXISTS "media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL,
  "url" text NOT NULL,
  "name" varchar(280) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "kind" varchar(24) DEFAULT 'image' NOT NULL,
  "size" integer DEFAULT 0 NOT NULL,
  "width" integer,
  "height" integer,
  "position" integer DEFAULT 0 NOT NULL,
  "alt_text" text DEFAULT '' NOT NULL,
  "source" varchar(24) DEFAULT 'upload' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "media_resource_id_idx" ON "media" ("resource_id");
CREATE INDEX IF NOT EXISTS "media_resource_position_idx" ON "media" ("resource_id", "position");

CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "prefix" varchar(24) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "scopes" text[] DEFAULT '{read}' NOT NULL,
  "created_by" varchar(320),
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_hash_unique" ON "api_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "api_tokens_prefix_idx" ON "api_tokens" ("prefix");
