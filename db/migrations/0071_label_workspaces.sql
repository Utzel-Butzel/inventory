CREATE TABLE label_workspaces (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  labels jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(labels) = 'array' AND jsonb_array_length(labels) <= 100),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
