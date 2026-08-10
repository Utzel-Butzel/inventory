CREATE TABLE IF NOT EXISTS "stock_movement_requests" (
  "idempotency_key" uuid PRIMARY KEY NOT NULL,
  "resource_id" uuid NOT NULL,
  "actor" varchar(320) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "stock_movement_requests_resource_id_idx"
  ON "stock_movement_requests" ("resource_id");
