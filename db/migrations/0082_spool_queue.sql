ALTER TABLE label_printers ADD COLUMN spool_snapshot jsonb, ADD COLUMN spool_checked_at timestamptz;
CREATE TABLE label_spool_commands (
  id uuid PRIMARY KEY,
  printer_id uuid NOT NULL REFERENCES label_printers(id) ON DELETE CASCADE,
  refs jsonb NOT NULL,
  created_by text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','claimed','done','uncertain','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '60 seconds'
);
CREATE INDEX label_spool_commands_printer_idx ON label_spool_commands(printer_id,created_at);
