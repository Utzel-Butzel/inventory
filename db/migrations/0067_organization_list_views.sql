CREATE TABLE IF NOT EXISTS organization_list_views (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope varchar(100) NOT NULL,
  collection jsonb NOT NULL DEFAULT '{"views":[],"defaultId":null}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, scope)
);
