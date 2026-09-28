CREATE TABLE IF NOT EXISTS ai_prompt_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  collection jsonb NOT NULL CHECK (jsonb_typeof(collection) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
