-- Durable per-principal MCP throttling and privacy-preserving tool audit events.

CREATE TABLE "mcp_rate_limit_buckets" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "bucket_key" varchar(64) NOT NULL,
  "principal_hash" varchar(64) NOT NULL,
  "operation" varchar(16) NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "request_count" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_rate_limit_buckets_pk"
    PRIMARY KEY ("organization_id", "bucket_key"),
  CONSTRAINT "mcp_rate_limit_buckets_operation_check"
    CHECK ("operation" IN ('request', 'read', 'write')),
  CONSTRAINT "mcp_rate_limit_buckets_count_positive"
    CHECK ("request_count" > 0)
);

CREATE INDEX "mcp_rate_limit_buckets_expiry_idx"
  ON "mcp_rate_limit_buckets" ("expires_at");

CREATE TABLE "mcp_audit_events" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "token_id" uuid REFERENCES "api_tokens"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "principal_hash" varchar(64) NOT NULL,
  "tool_name" varchar(80) NOT NULL,
  "operation" varchar(16) NOT NULL,
  "status" varchar(24) NOT NULL,
  "arguments_hash" varchar(64) NOT NULL,
  "target_ids" uuid[] DEFAULT '{}' NOT NULL,
  "duration_ms" integer NOT NULL,
  "error_code" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_audit_events_operation_check"
    CHECK ("operation" IN ('read', 'write')),
  CONSTRAINT "mcp_audit_events_status_check"
    CHECK ("status" IN ('success', 'error', 'rate_limited')),
  CONSTRAINT "mcp_audit_events_duration_nonnegative"
    CHECK ("duration_ms" >= 0)
);

CREATE INDEX "mcp_audit_events_org_created_idx"
  ON "mcp_audit_events" ("organization_id", "created_at");
CREATE INDEX "mcp_audit_events_token_created_idx"
  ON "mcp_audit_events" ("token_id", "created_at");

COMMENT ON TABLE "mcp_audit_events" IS
  'Privacy-preserving audit trail for MCP tool calls; inputs are hashed, never stored.';
