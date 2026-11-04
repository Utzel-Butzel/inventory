-- Browser-to-native handoff. Neither device credentials nor raw codes are stored.
CREATE TABLE native_auth_requests (
  request_hash varchar(64) PRIMARY KEY,
  origin text NOT NULL,
  code_challenge varchar(43) NOT NULL,
  state varchar(43) NOT NULL,
  device_name varchar(80) NOT NULL,
  browser_binding_hash varchar(64),
  code_hash varchar(64) UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  user_session_version integer,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  CONSTRAINT native_auth_requests_grant_check CHECK (
    (code_hash IS NULL AND user_id IS NULL AND user_session_version IS NULL AND organization_id IS NULL)
    OR (code_hash IS NOT NULL AND user_id IS NOT NULL AND user_session_version > 0 AND organization_id IS NOT NULL)
  )
);
CREATE INDEX native_auth_requests_expiry_idx ON native_auth_requests(expires_at);
