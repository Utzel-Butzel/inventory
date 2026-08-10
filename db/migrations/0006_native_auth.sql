ALTER TABLE "api_tokens"
  ADD COLUMN "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  ADD COLUMN "user_session_version" integer;

ALTER TABLE "api_tokens"
  ADD CONSTRAINT "api_tokens_user_binding_check"
  CHECK (
    ("user_id" IS NULL AND "user_session_version" IS NULL)
    OR ("user_id" IS NOT NULL AND "user_session_version" > 0)
  );

CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens" ("user_id");
