CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(320) NOT NULL,
  "name" varchar(160) NOT NULL,
  "password_hash" varchar(255) NOT NULL,
  "role" varchar(16) DEFAULT 'editor' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "session_version" integer DEFAULT 1 NOT NULL,
  "last_login_at" timestamp with time zone,
  "password_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email")),
  CONSTRAINT "users_role_check" CHECK ("role" in ('admin', 'editor', 'viewer')),
  CONSTRAINT "users_session_version_positive" CHECK ("session_version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "users_role_active_idx" ON "users" ("role", "is_active");
