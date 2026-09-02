ALTER TABLE "public_shares"
  ADD COLUMN IF NOT EXISTS "access_mode" varchar(16) DEFAULT 'view' NOT NULL,
  ADD COLUMN IF NOT EXISTS "password_hash" varchar(255);

ALTER TABLE "public_shares"
  ADD CONSTRAINT "public_shares_access_mode_check"
    CHECK ("access_mode" IN ('view', 'stock')),
  ADD CONSTRAINT "public_shares_stock_tool_check"
    CHECK (
      ("access_mode" = 'view' AND "password_hash" IS NULL)
      OR
      ("access_mode" = 'stock' AND "scope" = 'inventory' AND "password_hash" IS NOT NULL)
    );

COMMENT ON COLUMN "public_shares"."access_mode" IS
  'View keeps the existing read-only capability; stock enables the password-protected public stock tool.';
COMMENT ON COLUMN "public_shares"."password_hash" IS
  'Bcrypt hash used only by password-protected public stock-tool shares.';
