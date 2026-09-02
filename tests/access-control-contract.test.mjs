import assert from "node:assert/strict";
import test from "node:test";

import {
  accessRuleFields,
  accessRuleConditionMatches,
  accessRuleMatches,
  appPermissions,
  builtinRolePermissions,
  permissionScope,
  permissionsForScopes,
  resourceFieldValue,
  rulesGrantPermission,
  scopesForPermissions,
} from "../lib/access-control-contract.ts";

const resource = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  name: "  Cordless Drill  ",
  type: "tool",
  status: "AVAILABLE",
  sku: "XYZ-100",
  location: "Workshop A",
  serialNumber: null,
  priority: 0,
  tags: ["Power Tool", "Portable"],
  categories: ["Equipment", { name: "Workshop" }, { name: null }],
  customFields: {
    brand: "  Makita ",
    rechargeable: false,
    voltage: 18,
    empty: "",
  },
  createdBy: "owner@example.com",
};

const condition = (field, operator, value) => ({ field, operator, value });

test("resolves built-in, category-name, and custom field values", () => {
  for (const field of accessRuleFields) {
    if (field === "categories") continue;
    assert.deepEqual(resourceFieldValue(resource, field), resource[field]);
  }
  assert.deepEqual(resourceFieldValue(resource, "categories"), [
    "Equipment",
    "Workshop",
    null,
  ]);
  assert.equal(resourceFieldValue(resource, "customFields.brand"), "  Makita ");
  assert.equal(resourceFieldValue(resource, "customFields.missing"), undefined);
  assert.equal(resourceFieldValue(resource, "customFields.constructor"), undefined);
  assert.equal(resourceFieldValue(resource, "missing"), undefined);
});

test("equals and not_equals normalize strings and search array entries", () => {
  assert.equal(
    accessRuleConditionMatches(resource, condition("name", "equals", "cordless drill")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("tags", "equals", " power tool ")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("categories", "equals", "workshop")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("priority", "equals", 0)),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("priority", "equals", "0")),
    false,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("status", "not_equals", "archived")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("status", "not_equals", " available ")),
    false,
  );
});

test("contains and starts_with perform case-insensitive string matching", () => {
  assert.equal(
    accessRuleConditionMatches(resource, condition("name", "contains", "LESS DR")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("tags", "contains", "tool")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("sku", "starts_with", " xyz-")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("priority", "starts_with", "0")),
    false,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("name", "contains", "saw")),
    false,
  );
});

test("malformed and empty comparison conditions fail closed", () => {
  assert.equal(
    accessRuleConditionMatches(resource, {
      field: "name",
      operator: "contains",
      value: "   ",
    }),
    false,
  );
  assert.equal(
    accessRuleConditionMatches(resource, {
      field: "status",
      operator: "equals",
    }),
    false,
  );
  assert.equal(
    accessRuleConditionMatches(resource, {
      field: "status",
      operator: "unexpected",
      value: "available",
    }),
    false,
  );
});

test("exists and not_exists distinguish false and zero from empty values", () => {
  assert.equal(
    accessRuleConditionMatches(resource, condition("customFields.rechargeable", "exists")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("priority", "exists")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("serialNumber", "not_exists")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("customFields.empty", "not_exists")),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(
      { ...resource, tags: [] },
      condition("tags", "not_exists"),
    ),
    true,
  );
  assert.equal(
    accessRuleConditionMatches(
      resource,
      condition("customFields.constructor", "exists"),
    ),
    false,
  );
  assert.equal(
    accessRuleConditionMatches(resource, condition("unknown", "not_exists")),
    false,
  );
});

test("a rule requires every condition and rejects disabled or empty rules", () => {
  const matchingRule = {
    roleKey: "technician",
    permissions: ["inventory.update"],
    enabled: true,
    conditions: [
      condition("sku", "starts_with", "xyz-"),
      condition("customFields.brand", "equals", "makita"),
      condition("status", "not_equals", "archived"),
    ],
  };

  assert.equal(accessRuleMatches(resource, matchingRule), true);
  assert.equal(
    accessRuleMatches(resource, {
      ...matchingRule,
      conditions: [...matchingRule.conditions, condition("type", "equals", "vehicle")],
    }),
    false,
  );
  assert.equal(accessRuleMatches(resource, { ...matchingRule, enabled: false }), false);
  assert.equal(accessRuleMatches(resource, { ...matchingRule, conditions: [] }), false);
});

test("conditional grants require the requested role, permission, and a matching rule", () => {
  const rules = [
    {
      roleKey: "technician",
      permissions: ["inventory.update", "stock.manage"],
      enabled: true,
      conditions: [condition("sku", "starts_with", "xyz-")],
    },
    {
      roleKey: "technician",
      permissions: ["inventory.delete"],
      enabled: false,
      conditions: [condition("sku", "starts_with", "xyz-")],
    },
    {
      roleKey: "contractor",
      permissions: ["inventory.delete"],
      enabled: true,
      conditions: [condition("sku", "starts_with", "xyz-")],
    },
  ];

  assert.equal(
    rulesGrantPermission({
      roleKey: "technician",
      permission: "inventory.update",
      resource,
      rules,
    }),
    true,
  );
  assert.equal(
    rulesGrantPermission({
      roleKey: "technician",
      permission: "inventory.delete",
      resource,
      rules,
    }),
    false,
  );
  assert.equal(
    rulesGrantPermission({
      roleKey: "contractor",
      permission: "inventory.delete",
      resource: { ...resource, sku: "ABC-100" },
      rules,
    }),
    false,
  );
});

test("built-in roles have the intended default permission boundaries", () => {
  assert.deepEqual(builtinRolePermissions.admin, appPermissions);

  assert.equal(builtinRolePermissions.editor.includes("inventory.update"), true);
  for (const permission of [
    "ai.analyze",
    "ai.research",
    "ai.recognize",
    "ai.count",
    "ai.images",
    "ai.translate",
    "ai.rooms",
  ]) {
    assert.equal(builtinRolePermissions.editor.includes(permission), true);
  }
  for (const permission of [
    "settings.inventory-types.manage",
    "settings.custom-fields.manage",
    "settings.languages.manage",
    "users.manage",
    "roles.manage",
    "sharing.manage",
    "tokens.manage",
    "tokens.delegate",
    "webhooks.manage",
  ]) {
    assert.equal(builtinRolePermissions.editor.includes(permission), false);
  }

  assert.deepEqual(builtinRolePermissions.viewer, [
    "inventory.read",
    "stock.read",
    "assignments.read",
    "counts.read",
    "spatial.read",
    "orders.read",
    "requests.read",
    "workflows.read",
    "labels.read",
  ]);
});

test("permissions map to deterministic API scopes", () => {
  assert.equal(permissionScope("inventory.read"), "read");
  assert.equal(permissionScope("inventory.export"), "read");
  assert.equal(permissionScope("inventory.update"), "write");
  assert.equal(permissionScope("users.manage"), "write");
  assert.equal(permissionScope("ai.images"), "ai");

  assert.deepEqual(scopesForPermissions(builtinRolePermissions.admin), [
    "read",
    "write",
    "ai",
  ]);
  assert.deepEqual(scopesForPermissions(builtinRolePermissions.viewer), ["read"]);
  assert.deepEqual(scopesForPermissions(builtinRolePermissions.editor), [
    "read",
    "write",
    "ai",
  ]);
  assert.deepEqual(scopesForPermissions([]), []);

  assert.equal(permissionsForScopes(["read"]).includes("inventory.export"), true);
  assert.equal(permissionsForScopes(["read"]).includes("inventory.update"), false);
  assert.equal(permissionsForScopes(["write"]).includes("webhooks.manage"), false);
  assert.deepEqual(permissionsForScopes(["ai"]), [
    "ai.analyze",
    "ai.research",
    "ai.recognize",
    "ai.count",
    "ai.images",
    "ai.translate",
    "ai.rooms",
  ]);
});
