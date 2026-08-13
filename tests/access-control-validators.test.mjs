import assert from "node:assert/strict";
import test from "node:test";

import {
  accessRolePatchSchema,
  inventoryAccessRuleInputSchema,
  inventoryAccessRulePatchSchema,
} from "../lib/validators.ts";

test("role patches do not materialize create defaults", () => {
  assert.deepEqual(accessRolePatchSchema.parse({ name: "Warehouse" }), {
    name: "Warehouse",
  });
});

test("rule patches preserve omitted enabled, priority, and description fields", () => {
  assert.deepEqual(inventoryAccessRulePatchSchema.parse({ name: "Updated" }), {
    name: "Updated",
  });
});

test("comparison rules reject empty wildcard values", () => {
  const base = {
    name: "Tagged tools",
    roleKey: "tool-editor",
    permissions: ["inventory.update"],
    conditions: [{ field: "tags", operator: "contains", value: "   " }],
  };
  assert.equal(inventoryAccessRuleInputSchema.safeParse(base).success, false);
  assert.equal(
    inventoryAccessRuleInputSchema.safeParse({
      ...base,
      conditions: [{ field: "name", operator: "starts_with", value: "" }],
    }).success,
    false,
  );
});

test("rules accept custom-field keys and unary conditions without values", () => {
  assert.equal(
    inventoryAccessRuleInputSchema.safeParse({
      name: "Assigned equipment",
      roleKey: "equipment-team",
      permissions: ["inventory.update", "stock.manage"],
      conditions: [
        { field: "customFields.department", operator: "equals", value: "AV" },
        { field: "serialNumber", operator: "exists" },
      ],
    }).success,
    true,
  );
});
