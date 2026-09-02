CREATE TABLE IF NOT EXISTS "resource_favorites" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL,
  "resource_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_favorites_organization_user_resource_pk"
    PRIMARY KEY ("organization_id", "user_id", "resource_id"),
  CONSTRAINT "resource_favorites_membership_fk"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "organization_memberships"("organization_id", "user_id")
    ON DELETE CASCADE,
  CONSTRAINT "resource_favorites_resource_fk"
    FOREIGN KEY ("organization_id", "resource_id")
    REFERENCES "resources"("organization_id", "id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "resource_favorites_user_created_idx"
  ON "resource_favorites" ("organization_id", "user_id", "created_at");

COMMENT ON TABLE "resource_favorites" IS
  'Private per-user favorites within an organization inventory.';
