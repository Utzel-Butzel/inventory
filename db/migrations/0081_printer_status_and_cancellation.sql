ALTER TABLE label_printers
  ADD COLUMN agent_version integer NOT NULL DEFAULT 1,
  ADD COLUMN agent_status jsonb,
  ADD COLUMN status_checked_at timestamptz,
  ADD COLUMN status_requested_at timestamptz;
ALTER TABLE label_print_jobs
  ADD COLUMN dispatch_started_at timestamptz,
  ADD COLUMN cancel_requested_at timestamptz,
  ADD COLUMN cancel_result varchar(24),
  ADD COLUMN cancellable boolean NOT NULL DEFAULT false;
ALTER TABLE label_print_jobs DROP CONSTRAINT label_print_jobs_status_check;
ALTER TABLE label_print_jobs ADD CONSTRAINT label_print_jobs_status_check
  CHECK (status IN ('queued','claimed','submitted','completed','failed','uncertain','cancelled','expired'));
