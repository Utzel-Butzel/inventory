CREATE TABLE IF NOT EXISTS "resource_creation_requests" (
  "idempotency_key" uuid PRIMARY KEY NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "resource_id" uuid NOT NULL UNIQUE,
  "response" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "resource_creation_requests_resource_id_idx"
  ON "resource_creation_requests" ("resource_id");

CREATE TABLE IF NOT EXISTS "media_upload_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" uuid NOT NULL UNIQUE,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "media_upload_batches_resource_id_idx"
  ON "media_upload_batches" ("resource_id");

CREATE TABLE IF NOT EXISTS "media_upload_batch_items" (
  "batch_id" uuid NOT NULL REFERENCES "media_upload_batches"("id") ON DELETE CASCADE,
  "media_id" uuid PRIMARY KEY NOT NULL REFERENCES "media"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "media_upload_batch_items_batch_id_idx"
  ON "media_upload_batch_items" ("batch_id");
