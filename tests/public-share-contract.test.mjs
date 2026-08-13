import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicShareFilterValueCompatible,
  matchesPublicShareFilter,
  publicShareCreateSchema,
  publicShareFilterSchema,
  publicShareIdSchema,
} from "../lib/public-share-contract.ts";

test("accepts an unfiltered or filtered inventory share", () => {
  assert.equal(
    publicShareCreateSchema.safeParse({
      scope: "inventory",
      name: "Public catalogue",
    }).success,
    true,
  );
  assert.equal(
    publicShareCreateSchema.safeParse({
      scope: "inventory",
      name: "Samples",
      filter: { fieldKey: "samplefield", value: true },
    }).success,
    true,
  );
});

test("accepts item shares and rejects cross-scope properties", () => {
  const resourceId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  assert.equal(
    publicShareCreateSchema.safeParse({
      scope: "item",
      name: "One item",
      resourceId,
    }).success,
    true,
  );
  assert.equal(
    publicShareCreateSchema.safeParse({
      scope: "item",
      name: "One item",
      resourceId,
      filter: { fieldKey: "samplefield", value: true },
    }).success,
    false,
  );
  assert.equal(
    publicShareCreateSchema.safeParse({
      scope: "inventory",
      name: "Wrong target",
      resourceId,
    }).success,
    false,
  );
});

test("requires stable custom-field keys and scalar or string-array values", () => {
  assert.equal(
    publicShareFilterSchema.safeParse({ fieldKey: "samplefield", value: true })
      .success,
    true,
  );
  assert.equal(
    publicShareFilterSchema.safeParse({ fieldKey: "Sample Field", value: true })
      .success,
    false,
  );
  assert.equal(
    publicShareFilterSchema.safeParse({ fieldKey: "samplefield", value: {} })
      .success,
    false,
  );
});

test("matches filters using exact typed JSON equality", () => {
  const fields = {
    samplefield: true,
    count: 1,
    labels: ["sample", "featured"],
  };
  assert.equal(
    matchesPublicShareFilter(fields, { fieldKey: "samplefield", value: true }),
    true,
  );
  assert.equal(
    matchesPublicShareFilter(fields, { fieldKey: "samplefield", value: "true" }),
    false,
  );
  assert.equal(
    matchesPublicShareFilter(fields, { fieldKey: "count", value: "1" }),
    false,
  );
  assert.equal(
    matchesPublicShareFilter(fields, {
      fieldKey: "labels",
      value: ["featured", "sample"],
    }),
    false,
  );
  assert.equal(
    matchesPublicShareFilter(fields, { fieldKey: "missing", value: true }),
    false,
  );
});

test("checks filter values against their custom-field type", () => {
  const base = {
    options: [],
    referenceMultiple: false,
    minValue: null,
    maxValue: null,
    step: null,
  };
  assert.equal(
    isPublicShareFilterValueCompatible(
      { ...base, fieldType: "boolean" },
      true,
    ),
    true,
  );
  assert.equal(
    isPublicShareFilterValueCompatible(
      { ...base, fieldType: "boolean" },
      "true",
    ),
    false,
  );
  assert.equal(
    isPublicShareFilterValueCompatible(
      {
        ...base,
        fieldType: "number",
        minValue: 2,
        maxValue: 10,
        step: 2,
      },
      5,
    ),
    false,
  );
  assert.equal(
    isPublicShareFilterValueCompatible(
      {
        ...base,
        fieldType: "number",
        minValue: 2,
        maxValue: 10,
        step: 2,
      },
      6,
    ),
    true,
  );
  assert.equal(
    isPublicShareFilterValueCompatible(
      {
        ...base,
        fieldType: "select",
        options: [{ value: "sample", label: "Sample" }],
      },
      "other",
    ),
    false,
  );
  assert.equal(
    isPublicShareFilterValueCompatible(
      { ...base, fieldType: "reference" },
      "not-a-uuid",
    ),
    false,
  );
});

test("only UUID capabilities are accepted as share identifiers", () => {
  assert.equal(
    publicShareIdSchema.safeParse(
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    ).success,
    true,
  );
  assert.equal(publicShareIdSchema.safeParse("../api/files/private").success, false);
});
