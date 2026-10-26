CREATE TABLE label_printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  tape_width double precision NOT NULL DEFAULT 24 CHECK (tape_width IN (3.5,6,9,12,18,24)),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE label_print_jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  printer_id uuid NOT NULL REFERENCES label_printers(id) ON DELETE CASCADE,
  created_by text NOT NULL,
  label_count integer NOT NULL CHECK (label_count BETWEEN 1 AND 100),
  payload text,
  payload_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','submitted','failed','uncertain','cancelled','expired')),
  claim_id uuid,
  spool_job_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  claimed_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX label_print_jobs_queue_idx ON label_print_jobs(printer_id, status, created_at);
CREATE INDEX label_print_jobs_org_idx ON label_print_jobs(organization_id, created_at);
CREATE UNIQUE INDEX label_print_jobs_claim_idx ON label_print_jobs(printer_id, claim_id) WHERE claim_id IS NOT NULL;
