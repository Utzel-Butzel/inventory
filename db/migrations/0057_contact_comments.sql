CREATE TABLE IF NOT EXISTS "contact_comments" (
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL,
  "body" text NOT NULL,
  "author_name" varchar(160) NOT NULL,
  "author_identity_hash" varchar(64) NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_comments_organization_contact_fk"
    FOREIGN KEY ("organization_id", "contact_id")
    REFERENCES "contacts"("organization_id", "id")
    ON DELETE CASCADE,
  CONSTRAINT "contact_comments_body_length_check"
    CHECK (length(btrim("body")) BETWEEN 1 AND 10000),
  CONSTRAINT "contact_comments_author_name_nonempty"
    CHECK (length(btrim("author_name")) > 0),
  CONSTRAINT "contact_comments_author_identity_hash_check"
    CHECK ("author_identity_hash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS "contact_comments_contact_created_idx"
  ON "contact_comments" ("organization_id", "contact_id", "created_at");

COMMENT ON TABLE "contact_comments" IS
  'Editable Markdown discussion threads attached to organization contacts.';
