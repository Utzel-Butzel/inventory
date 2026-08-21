ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "developer_mode" boolean DEFAULT false NOT NULL;
