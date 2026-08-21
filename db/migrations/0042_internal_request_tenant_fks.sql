ALTER TABLE "internal_requests"
  ADD CONSTRAINT "internal_requests_organization_delivery_fk"
  FOREIGN KEY ("organization_id", "delivery_resource_id")
  REFERENCES "resources" ("organization_id", "id");

ALTER TABLE "internal_request_lines"
  ADD CONSTRAINT "internal_request_lines_organization_request_fk"
  FOREIGN KEY ("organization_id", "request_id")
  REFERENCES "internal_requests" ("organization_id", "id")
  ON DELETE CASCADE;

ALTER TABLE "internal_request_lines"
  ADD CONSTRAINT "internal_request_lines_organization_resource_fk"
  FOREIGN KEY ("organization_id", "resource_id")
  REFERENCES "resources" ("organization_id", "id")
  ON DELETE RESTRICT;

ALTER TABLE "internal_request_events"
  ADD CONSTRAINT "internal_request_events_organization_request_fk"
  FOREIGN KEY ("organization_id", "request_id")
  REFERENCES "internal_requests" ("organization_id", "id")
  ON DELETE CASCADE;

ALTER TABLE "inventory_assignments"
  ADD CONSTRAINT "inventory_assignments_organization_internal_request_line_fk"
  FOREIGN KEY ("organization_id", "internal_request_line_id")
  REFERENCES "internal_request_lines" ("organization_id", "id")
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT "internal_request_lines_organization_request_fk"
  ON "internal_request_lines" IS
  'Prevents internal-request lines from crossing organization boundaries.';
