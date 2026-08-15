-- Read-only organizations are used for public product demonstrations and
-- other tenants whose data must never be changed through the application.
-- Existing organizations remain writable.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "is_read_only" boolean DEFAULT false NOT NULL;
