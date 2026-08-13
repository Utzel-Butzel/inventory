import assert from "node:assert/strict";
import test from "node:test";

import {
  isCustomFieldReferenceTargetApplicable,
  normalizeCustomFieldKey,
} from "../lib/custom-field-contract.ts";
import { customFieldDefinitionCreateSchema } from "../lib/validators.ts";

const referenceDefinition = {
  referenceResourceTypes: ["other"],
  referenceCategories: ["Manufacturer"],
  referenceStatuses: ["available"],
};

test("reference target filters require type, category, and status when configured", () => {
  assert.equal(
    isCustomFieldReferenceTargetApplicable(referenceDefinition, {
      type: "other",
      categories: [{ name: "manufacturer" }],
      status: "AVAILABLE",
    }),
    true,
  );
  assert.equal(
    isCustomFieldReferenceTargetApplicable(referenceDefinition, {
      type: "other",
      categories: [{ name: "Supplier" }],
      status: "available",
    }),
    false,
  );
  assert.equal(
    isCustomFieldReferenceTargetApplicable(referenceDefinition, {
      type: "other",
      categories: [{ name: "Manufacturer" }],
      status: "archived",
    }),
    false,
  );
});

test("empty reference filters match every target", () => {
  assert.equal(
    isCustomFieldReferenceTargetApplicable(
      {
        referenceResourceTypes: [],
        referenceCategories: [],
        referenceStatuses: [],
      },
      { type: "tool", categories: [], status: "maintenance" },
    ),
    true,
  );
});

test("reference definitions require a target collection", () => {
  const result = customFieldDefinitionCreateSchema.safeParse({
    entityType: "inventory",
    key: normalizeCustomFieldKey("Manufacturer"),
    label: "Manufacturer",
    fieldType: "reference",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(
      result.error.issues.some((issue) => issue.path[0] === "referenceEntityType"),
      true,
    );
  }
});

test("reference definitions accept inventory and stock-unit targets", () => {
  for (const referenceEntityType of ["inventory", "stock_unit"]) {
    const result = customFieldDefinitionCreateSchema.safeParse({
      entityType: "stock_unit",
      label: "Supplier",
      fieldType: "reference",
      referenceEntityType,
      referenceMultiple: true,
      referenceCategories: ["Manufacturer"],
    });
    assert.equal(result.success, true);
  }
});

test("stock-unit references reject unknown stock statuses", () => {
  const result = customFieldDefinitionCreateSchema.safeParse({
    entityType: "inventory",
    label: "Installed unit",
    fieldType: "reference",
    referenceEntityType: "stock_unit",
    referenceStatuses: ["available", "on-mars"],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(
      result.error.issues.some((issue) => issue.path[0] === "referenceStatuses"),
      true,
    );
  }
});

test("non-reference definitions reject dormant reference configuration", () => {
  const result = customFieldDefinitionCreateSchema.safeParse({
    entityType: "inventory",
    label: "Color",
    fieldType: "text",
    referenceEntityType: "inventory",
  });
  assert.equal(result.success, false);
});
