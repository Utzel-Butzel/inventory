CREATE TABLE order_loan_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_line_id uuid NOT NULL,
  movement_id uuid NOT NULL REFERENCES stock_movements(id) ON DELETE RESTRICT,
  unit_id uuid,
  phase varchar(16) NOT NULL CHECK (phase IN ('checkout', 'return')),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_loan_handovers_line_fk FOREIGN KEY (organization_id, order_line_id)
    REFERENCES order_lines(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_loan_handovers_movement_unique UNIQUE (movement_id)
);
CREATE INDEX order_loan_handovers_line_idx ON order_loan_handovers(organization_id, order_line_id, unit_id);
