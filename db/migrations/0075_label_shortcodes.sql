-- Keep reservations after deletion: a printed code must never point at another item.
-- Targets are validated on creation and resolution, rather than cascading deletes.
CREATE TABLE label_shortcodes (
  code varchar(8) PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9_-]{8}$'),
  organization_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  stock_unit_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX label_shortcodes_resource_unique
  ON label_shortcodes (organization_id, resource_id) WHERE stock_unit_id IS NULL;
CREATE UNIQUE INDEX label_shortcodes_unit_unique
  ON label_shortcodes (organization_id, resource_id, stock_unit_id) WHERE stock_unit_id IS NOT NULL;
