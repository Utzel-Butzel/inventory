CREATE TABLE IF NOT EXISTS user_list_views (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope varchar(100) NOT NULL,
  collection jsonb NOT NULL DEFAULT '{"views":[],"defaultId":null}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, scope)
);
