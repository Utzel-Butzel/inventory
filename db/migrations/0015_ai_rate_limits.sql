CREATE TABLE IF NOT EXISTS "ai_rate_limit_buckets" (
  "operation" varchar(24) NOT NULL,
  "subject_hash" varchar(64) NOT NULL,
  "request_count" integer DEFAULT 1 NOT NULL,
  "resets_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_rate_limit_buckets_operation_subject_pk"
    PRIMARY KEY ("operation", "subject_hash"),
  CONSTRAINT "ai_rate_limit_buckets_operation_check"
    CHECK ("operation" IN ('analyze', 'count', 'cover')),
  CONSTRAINT "ai_rate_limit_buckets_request_count_positive"
    CHECK ("request_count" > 0),
  CONSTRAINT "ai_rate_limit_buckets_subject_hash_check"
    CHECK ("subject_hash" ~ '^[0-9a-f]{64}$')
);
