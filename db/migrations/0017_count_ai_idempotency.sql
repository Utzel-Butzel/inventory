ALTER TABLE "ai_idempotency_operations"
  DROP CONSTRAINT IF EXISTS "ai_idempotency_operations_operation_check";

ALTER TABLE "ai_idempotency_operations"
  ADD CONSTRAINT "ai_idempotency_operations_operation_check"
  CHECK ("operation" IN ('analyze', 'count', 'cover'));
