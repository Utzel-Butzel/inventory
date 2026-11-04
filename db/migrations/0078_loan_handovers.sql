ALTER TABLE inventory_assignments
  ADD COLUMN checkout_documented_at timestamptz,
  ADD COLUMN return_documented_at timestamptz;

CREATE UNIQUE INDEX inventory_assignments_organization_id_id_unique
  ON inventory_assignments (organization_id, id);

CREATE TABLE loan_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  phase varchar(16) NOT NULL CHECK (phase IN ('checkout', 'return')),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loan_handovers_assignment_fk FOREIGN KEY (organization_id, assignment_id)
    REFERENCES inventory_assignments(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT loan_handovers_assignment_phase_unique UNIQUE (organization_id, assignment_id, phase)
);
