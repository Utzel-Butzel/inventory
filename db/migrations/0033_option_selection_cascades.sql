-- Option selections are owned join rows. Removing an option group or value
-- must remove its selections so deleting the owning inventory item can finish.
ALTER TABLE "resource_option_selections"
  DROP CONSTRAINT IF EXISTS "resource_option_selections_group_id_fkey",
  ADD CONSTRAINT "resource_option_selections_group_id_fkey"
    FOREIGN KEY ("group_id")
    REFERENCES "resource_option_groups"("id") ON DELETE CASCADE;

ALTER TABLE "resource_option_selections"
  DROP CONSTRAINT IF EXISTS "resource_option_selections_value_id_fkey",
  ADD CONSTRAINT "resource_option_selections_value_id_fkey"
    FOREIGN KEY ("value_id")
    REFERENCES "resource_option_values"("id") ON DELETE CASCADE;

ALTER TABLE "resource_option_selections"
  DROP CONSTRAINT IF EXISTS "resource_option_selections_organization_group_fk",
  ADD CONSTRAINT "resource_option_selections_organization_group_fk"
    FOREIGN KEY ("organization_id", "group_id")
    REFERENCES "resource_option_groups"("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "resource_option_selections"
  DROP CONSTRAINT IF EXISTS "resource_option_selections_group_value_fk",
  ADD CONSTRAINT "resource_option_selections_group_value_fk"
    FOREIGN KEY ("group_id", "value_id")
    REFERENCES "resource_option_values"("group_id", "id") ON DELETE CASCADE;
