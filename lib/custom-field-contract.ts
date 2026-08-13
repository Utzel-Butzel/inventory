export const customFieldEntityTypes = ["inventory", "stock_unit"] as const;
export type CustomFieldEntityType = (typeof customFieldEntityTypes)[number];

export const customFieldTypes = [
  "text",
  "textarea",
  "number",
  "boolean",
  "date",
  "datetime",
  "select",
  "multi_select",
  "reference",
  "email",
  "url",
] as const;
export type CustomFieldType = (typeof customFieldTypes)[number];

export const customFieldResourceTypes = [
  "place",
  "person",
  "vehicle",
  "tool",
  "project",
  "clothing",
  "furniture",
  "object",
  "other",
] as const;
export type CustomFieldResourceType = string;

export type CustomFieldOption = {
  value: string;
  label: string;
  color?: string;
};

export type CustomFieldValue = string | number | boolean | string[];
export type CustomFieldValues = Record<string, CustomFieldValue>;

export type CustomFieldReferenceOption = {
  id: string;
  entityType: CustomFieldEntityType;
  label: string;
  description: string;
  status: string;
};

export type CustomFieldDefinition = {
  id: string;
  entityType: CustomFieldEntityType;
  key: string;
  label: string;
  description: string;
  placeholder: string;
  fieldType: CustomFieldType;
  required: boolean;
  minValue: number | null;
  maxValue: number | null;
  step: number | null;
  resourceTypes: CustomFieldResourceType[];
  categories: string[];
  options: CustomFieldOption[];
  referenceEntityType: CustomFieldEntityType | null;
  referenceMultiple: boolean;
  referenceResourceTypes: CustomFieldResourceType[];
  referenceCategories: string[];
  referenceStatuses: string[];
  position: number;
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CustomFieldTarget = {
  type: string;
  categories: Array<string | { name: string }>;
};

export type CustomFieldReferenceTarget = CustomFieldTarget & {
  status: string;
};

const normalizedTarget = (value: string) => value.trim().toLowerCase();

export function normalizeCustomFieldKey(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "";
  return (/^[a-z]/.test(normalized) ? normalized : `field_${normalized}`).slice(
    0,
    64,
  );
}

/**
 * Empty target arrays are wildcards. When type and category targets are both
 * configured, both must match. A resource matches a category target when at
 * least one of its categories is listed.
 */
export function isCustomFieldDefinitionApplicable(
  definition: Pick<CustomFieldDefinition, "resourceTypes" | "categories">,
  target: CustomFieldTarget,
) {
  const targetType = normalizedTarget(target.type);
  const typeMatches =
    definition.resourceTypes.length === 0 ||
    definition.resourceTypes.some(
      (resourceType) => normalizedTarget(resourceType) === targetType,
    );
  if (!typeMatches) return false;

  if (definition.categories.length === 0) return true;
  const resourceCategories = new Set(
    target.categories.map((category) =>
      normalizedTarget(typeof category === "string" ? category : category.name),
    ),
  );
  return definition.categories.some((category) =>
    resourceCategories.has(normalizedTarget(category)),
  );
}

/**
 * Reference filters use the same wildcard and AND semantics as field
 * applicability, with an optional status filter layered on top.
 */
export function isCustomFieldReferenceTargetApplicable(
  definition: Pick<
    CustomFieldDefinition,
    "referenceResourceTypes" | "referenceCategories" | "referenceStatuses"
  >,
  target: CustomFieldReferenceTarget,
) {
  if (
    !isCustomFieldDefinitionApplicable(
      {
        resourceTypes: definition.referenceResourceTypes,
        categories: definition.referenceCategories,
      },
      target,
    )
  ) {
    return false;
  }
  const targetStatus = normalizedTarget(target.status);
  return (
    definition.referenceStatuses.length === 0 ||
    definition.referenceStatuses.some(
      (status) => normalizedTarget(status) === targetStatus,
    )
  );
}
