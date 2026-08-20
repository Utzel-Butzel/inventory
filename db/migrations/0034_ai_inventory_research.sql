ALTER TABLE "ai_rate_limit_buckets"
  DROP CONSTRAINT IF EXISTS "ai_rate_limit_buckets_operation_check";
ALTER TABLE "ai_rate_limit_buckets"
  ADD CONSTRAINT "ai_rate_limit_buckets_operation_check"
  CHECK ("operation" IN ('analyze', 'research', 'recognize', 'count', 'cover', 'translate'));

ALTER TABLE "ai_idempotency_operations"
  DROP CONSTRAINT IF EXISTS "ai_idempotency_operations_operation_check";
ALTER TABLE "ai_idempotency_operations"
  ADD CONSTRAINT "ai_idempotency_operations_operation_check"
  CHECK ("operation" IN ('analyze', 'research', 'recognize', 'count', 'cover', 'translate'));
