CREATE TABLE IF NOT EXISTS "ai_idempotency_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation" varchar(24) NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "resource_id" uuid NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "status" varchar(16) DEFAULT 'processing' NOT NULL,
  "response_status" integer,
  "response" jsonb,
  "response_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_idempotency_operations_operation_check"
    CHECK ("operation" IN ('analyze', 'cover')),
  CONSTRAINT "ai_idempotency_operations_status_check"
    CHECK ("status" IN ('processing', 'completed', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_idempotency_operations_operation_key_unique"
  ON "ai_idempotency_operations" ("operation", "idempotency_key");
CREATE INDEX IF NOT EXISTS "ai_idempotency_operations_resource_id_idx"
  ON "ai_idempotency_operations" ("resource_id");
