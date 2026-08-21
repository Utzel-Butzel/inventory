import { z } from "zod";

import { stockUnitStatuses } from "@/db/schema";
import {
  accessRuleOperators,
  appPermissions,
  resourceRulePermissions,
} from "@/lib/access-control-contract";
import {
  customFieldEntityTypes,
  customFieldTypes,
} from "@/lib/custom-field-contract";
import {
  coverTransparencyMethods,
} from "@/lib/cover-generation-contract";
import { maximumGeneratedImageSizes } from "@/lib/image-generation-size";
import {
  isOrganizationSlug,
  ORGANIZATION_SLUG_MAX_LENGTH,
} from "@/lib/organization-path";
import { resourceSlugsSchema } from "@/lib/resource-slug-contract";

const passwordSchema = z
  .string()
  .min(12, "Password must contain at least 12 characters.")
  .max(72, "Password must contain at most 72 characters.")
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    "Password must contain at most 72 UTF-8 bytes.",
  );

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

const customFieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Keys must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.",
  );

export const inventoryTypeKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    "Resource type keys must start with a lowercase letter and contain only lowercase letters, numbers, underscores, and dashes.",
  );

const customFieldOptionSchema = z
  .object({
    value: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    color: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

const customFieldDefinitionShape = {
  entityType: z.enum(customFieldEntityTypes),
  key: customFieldKeySchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5_000),
  placeholder: z.string().trim().max(240),
  fieldType: z.enum(customFieldTypes),
  required: z.boolean(),
  minValue: z.number().finite().nullable(),
  maxValue: z.number().finite().nullable(),
  step: z.number().finite().positive().nullable(),
  resourceTypes: z.array(inventoryTypeKeySchema).max(100),
  categories: z.array(z.string().trim().min(1).max(120)).max(40),
  options: z.array(customFieldOptionSchema).max(100),
  referenceEntityType: z.enum(customFieldEntityTypes).nullable(),
  referenceMultiple: z.boolean(),
  referenceResourceTypes: z.array(inventoryTypeKeySchema).max(100),
  referenceCategories: z.array(z.string().trim().min(1).max(120)).max(40),
  referenceStatuses: z.array(z.string().trim().min(1).max(32)).max(40),
  position: z.number().int().min(0).max(100_000),
};

const validateCustomFieldDefinition = (
  value: {
    fieldType?: (typeof customFieldTypes)[number];
    minValue?: number | null;
    maxValue?: number | null;
    step?: number | null;
    resourceTypes?: string[];
    categories?: string[];
    options?: Array<{ value: string }>;
    referenceEntityType?: (typeof customFieldEntityTypes)[number] | null;
    referenceMultiple?: boolean;
    referenceResourceTypes?: string[];
    referenceCategories?: string[];
    referenceStatuses?: string[];
  },
  context: z.RefinementCtx,
) => {
  if (
    value.minValue !== undefined &&
    value.maxValue !== undefined &&
    value.minValue !== null &&
    value.maxValue !== null &&
    value.minValue > value.maxValue
  ) {
    context.addIssue({
      code: "custom",
      path: ["maxValue"],
      message: "Maximum must be greater than or equal to minimum.",
    });
  }
  if (value.resourceTypes && new Set(value.resourceTypes).size !== value.resourceTypes.length) {
    context.addIssue({
      code: "custom",
      path: ["resourceTypes"],
      message: "Resource types must be unique.",
    });
  }
  if (value.categories) {
    const normalized = value.categories.map((category) => category.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        path: ["categories"],
        message: "Categories must be unique (case-insensitive).",
      });
    }
  }
  for (const [path, entries] of [
    ["referenceResourceTypes", value.referenceResourceTypes],
    ["referenceCategories", value.referenceCategories],
    ["referenceStatuses", value.referenceStatuses],
  ] as const) {
    if (!entries) continue;
    const normalized = entries.map((entry) => entry.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        path: [path],
        message: "Reference filters must be unique (case-insensitive).",
      });
    }
  }
  if (value.options) {
    const optionValues = value.options.map((option) => option.value);
    if (new Set(optionValues).size !== optionValues.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Option values must be unique.",
      });
    }
  }
  if (value.fieldType) {
    const selectable = value.fieldType === "select" || value.fieldType === "multi_select";
    if (selectable && value.options && value.options.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Select fields require at least one option.",
      });
    }
    if (!selectable && value.options && value.options.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Options are only supported by select fields.",
      });
    }
    if (
      value.fieldType !== "number" &&
      [value.minValue, value.maxValue, value.step].some(
        (entry) => entry !== undefined && entry !== null,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["minValue"],
        message: "Number limits are only supported by number fields.",
      });
    }
    if (value.fieldType === "reference") {
      if (!value.referenceEntityType) {
        context.addIssue({
          code: "custom",
          path: ["referenceEntityType"],
          message: "Reference fields require a target collection.",
        });
      }
      if (
        value.referenceEntityType === "stock_unit" &&
        value.referenceStatuses?.some(
          (status) =>
            !stockUnitStatuses.includes(
              status.toLowerCase() as (typeof stockUnitStatuses)[number],
            ),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["referenceStatuses"],
          message: "Stock-unit status filters must use a supported stock status.",
        });
      }
    } else if (
      value.referenceEntityType !== undefined &&
      (value.referenceEntityType !== null ||
        value.referenceMultiple === true ||
        (value.referenceResourceTypes?.length ?? 0) > 0 ||
        (value.referenceCategories?.length ?? 0) > 0 ||
        (value.referenceStatuses?.length ?? 0) > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["referenceEntityType"],
        message: "Reference settings are only supported by reference fields.",
      });
    }
  }
};

export const customFieldDefinitionCreateSchema = z
  .object({
    entityType: customFieldDefinitionShape.entityType,
    key: customFieldDefinitionShape.key.optional(),
    label: customFieldDefinitionShape.label,
    description: customFieldDefinitionShape.description.optional().default(""),
    placeholder: customFieldDefinitionShape.placeholder.optional().default(""),
    fieldType: customFieldDefinitionShape.fieldType,
    required: customFieldDefinitionShape.required.optional().default(false),
    minValue: customFieldDefinitionShape.minValue.optional().default(null),
    maxValue: customFieldDefinitionShape.maxValue.optional().default(null),
    step: customFieldDefinitionShape.step.optional().default(null),
    resourceTypes: customFieldDefinitionShape.resourceTypes.optional().default([]),
    categories: customFieldDefinitionShape.categories.optional().default([]),
    options: customFieldDefinitionShape.options.optional().default([]),
    referenceEntityType: customFieldDefinitionShape.referenceEntityType
      .optional()
      .default(null),
    referenceMultiple: customFieldDefinitionShape.referenceMultiple
      .optional()
      .default(false),
    referenceResourceTypes: customFieldDefinitionShape.referenceResourceTypes
      .optional()
      .default([]),
    referenceCategories: customFieldDefinitionShape.referenceCategories
      .optional()
      .default([]),
    referenceStatuses: customFieldDefinitionShape.referenceStatuses
      .optional()
      .default([]),
    position: customFieldDefinitionShape.position.optional().default(0),
  })
  .strict()
  .superRefine(validateCustomFieldDefinition);

export const customFieldDefinitionPatchSchema = z
  .object({
    revision: z.number().int().min(1),
    label: customFieldDefinitionShape.label.optional(),
    description: customFieldDefinitionShape.description.optional(),
    placeholder: customFieldDefinitionShape.placeholder.optional(),
    fieldType: customFieldDefinitionShape.fieldType.optional(),
    required: customFieldDefinitionShape.required.optional(),
    minValue: customFieldDefinitionShape.minValue.optional(),
    maxValue: customFieldDefinitionShape.maxValue.optional(),
    step: customFieldDefinitionShape.step.optional(),
    resourceTypes: customFieldDefinitionShape.resourceTypes.optional(),
    categories: customFieldDefinitionShape.categories.optional(),
    options: customFieldDefinitionShape.options.optional(),
    referenceEntityType: customFieldDefinitionShape.referenceEntityType.optional(),
    referenceMultiple: customFieldDefinitionShape.referenceMultiple.optional(),
    referenceResourceTypes: customFieldDefinitionShape.referenceResourceTypes.optional(),
    referenceCategories: customFieldDefinitionShape.referenceCategories.optional(),
    referenceStatuses: customFieldDefinitionShape.referenceStatuses.optional(),
    position: customFieldDefinitionShape.position.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "revision"), {
    message: "Provide at least one custom field change.",
  });

const customFieldScalarSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(120)).max(100),
]);

export const customFieldValuesInputSchema = z
  .record(customFieldKeySchema, customFieldScalarSchema)
  .refine((value) => Object.keys(value).length <= 100, {
    message: "At most 100 custom field values are allowed.",
  })
  .refine((value) => JSON.stringify(value).length <= 50_000, {
    message: "Custom field values must be 50 KB or smaller.",
  });

const mapCoordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const mapFeatureBase = {
  id: z.string().trim().min(1).max(80),
  layer: z.string().trim().min(1).max(80),
  description: z.string().trim().max(5_000),
};

export const resourceMapFeatureSchema = z.discriminatedUnion("type", [
  z.object({
    ...mapFeatureBase,
    type: z.literal("point"),
    coordinates: mapCoordinateSchema,
  }),
  z.object({
    ...mapFeatureBase,
    type: z.literal("polygon"),
    coordinates: z
      .array(mapCoordinateSchema)
      .min(4)
      .max(500)
      .refine(
        (coordinates) => {
          const first = coordinates[0];
          const last = coordinates.at(-1);
          return Boolean(first && last && first[0] === last[0] && first[1] === last[1]);
        },
        "Polygon rings must be closed.",
      ),
  }),
]);

const resourceShape = {
  name: z.string().trim().min(1).max(240),
  slugs: resourceSlugsSchema,
  description: z.string().trim().max(20_000),
  type: inventoryTypeKeySchema,
  status: z.enum(["available", "in-use", "maintenance", "archived"]),
  sku: nullableText(80),
  quantity: z.coerce.number().int().min(0).max(1_000_000),
  location: nullableText(240),
  serialNumber: nullableText(180),
  barcode: nullableText(180),
  valueCents: z.coerce.number().int().min(0).max(2_000_000_000).nullable(),
  currency: z.string().trim().length(3).toUpperCase(),
  priority: z.coerce.number().int().min(1).max(5),
  tags: z.array(z.string().trim().min(1).max(60)).max(80),
  categories: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        color: z.string().trim().max(24).optional(),
      }),
    )
    .max(40),
  customFields: customFieldValuesInputSchema,
  relatedResourceIds: z.array(z.string().uuid()).max(100),
  gpsLatitude: z.coerce.number().min(-90).max(90).nullable(),
  gpsLongitude: z.coerce.number().min(-180).max(180).nullable(),
  gpsAltitude: z.coerce.number().min(-12_000).max(100_000).nullable(),
  mapFeatures: z.array(resourceMapFeatureSchema).max(100),
  notes: z.string().trim().max(20_000),
};

export const resourceInputSchema = z.object({
  ...resourceShape,
  slugs: resourceShape.slugs.optional().default([]),
  description: resourceShape.description.optional().default(""),
  type: resourceShape.type.optional().default("object"),
  status: resourceShape.status.optional().default("available"),
  sku: resourceShape.sku.optional(),
  quantity: resourceShape.quantity.optional().default(1),
  location: resourceShape.location.optional(),
  serialNumber: resourceShape.serialNumber.optional(),
  barcode: resourceShape.barcode.optional(),
  valueCents: resourceShape.valueCents.optional(),
  currency: resourceShape.currency.optional().default("EUR"),
  priority: resourceShape.priority.optional().default(3),
  tags: resourceShape.tags.optional().default([]),
  categories: resourceShape.categories.optional().default([]),
  customFields: resourceShape.customFields.optional(),
  relatedResourceIds: resourceShape.relatedResourceIds.optional().default([]),
  gpsLatitude: resourceShape.gpsLatitude.optional(),
  gpsLongitude: resourceShape.gpsLongitude.optional(),
  gpsAltitude: resourceShape.gpsAltitude.optional(),
  mapFeatures: resourceShape.mapFeatures.optional().default([]),
  notes: resourceShape.notes.optional().default(""),
});

// Build the PATCH validator from validators without defaults. Calling .partial()
// on resourceInputSchema would otherwise materialize defaults (including
// quantity: 1) for fields the client did not send.
export const resourcePatchSchema = z.object(resourceShape).partial();

export const resourceBatchPatchSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    changes: z
      .object({
        type: resourceShape.type.optional(),
        status: resourceShape.status.optional(),
        location: resourceShape.location.optional(),
        priority: resourceShape.priority.optional(),
      })
      .default({}),
    addTags: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  })
  .refine(
    ({ changes, addTags }) => Object.keys(changes).length > 0 || addTags.length > 0,
    "Choose at least one batch change.",
  );

export const tokenInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z
    .array(z.enum(["read", "write", "ai"]))
    .min(1)
    .default(["read"]),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const nativeLoginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z
    .string()
    .min(1)
    .max(72)
    .refine(
      (value) => new TextEncoder().encode(value).length <= 72,
      "Password must contain at most 72 UTF-8 bytes.",
    ),
  deviceName: z.string().trim().min(1).max(80).optional().default("iOS"),
  organizationId: z.string().uuid().optional(),
});

export const organizationSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_SLUG_MAX_LENGTH)
  .transform((value) => value.toLowerCase())
  .refine(
    isOrganizationSlug,
    "Use lowercase letters, numbers, and single dashes; this slug may be reserved.",
  );

export const organizationCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: organizationSlugSchema.optional(),
  })
  .strict();

export const organizationUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    slug: organizationSlugSchema.optional(),
    allowNegativeStock: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Provide an organization setting to update.",
  });

export const organizationSelectInputSchema = z
  .object({
    organizationId: z.string().uuid(),
  })
  .strict();

export const analyzeInputSchema = z.object({
  overwrite: z.boolean().optional().default(true),
  prompt: z.string().trim().max(5_000).optional(),
});

export const researchInputSchema = z.object({}).strict();

export const coverInputSchema = z.object({
  sourceMediaId: z.string().uuid().optional(),
  prompt: z.string().trim().max(5_000).optional(),
  modelId: z.string().trim().min(1).max(240).optional(),
  maximumImageSize: z.literal(maximumGeneratedImageSizes).optional(),
  transparentBackground: z.boolean().optional(),
  transparencyMethod: z.enum(coverTransparencyMethods).optional(),
});

export const inventoryImageInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("search"),
      query: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("generate"),
      prompt: z.string().trim().min(1).max(5_000).optional(),
      modelId: z.string().trim().min(1).max(240).optional(),
      maximumImageSize: z.literal(maximumGeneratedImageSizes).optional(),
    })
    .strict(),
]);

export const inventoryCountInputSchema = z
  .object({
    itemHint: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const userCreateInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  name: z.string().trim().min(1).max(160),
  password: passwordSchema,
  role: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).default("editor"),
});

export const userUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    role: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
    isActive: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Provide at least one user change.",
  });

export const accessRoleInputSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).default(""),
  permissions: z.array(z.enum(appPermissions)).max(appPermissions.length).default([]),
});

export const accessRolePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1_000).optional(),
    permissions: z
      .array(z.enum(appPermissions))
      .max(appPermissions.length)
      .optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Provide at least one role change.",
  });

const accessRuleConditionSchema = z
  .object({
    field: z
      .string()
      .trim()
      .regex(
        /^(id|name|type|status|sku|location|serialNumber|priority|tags|categories|createdBy|customFields\.[A-Za-z0-9_-]{1,120})$/,
      ),
    operator: z.enum(accessRuleOperators),
    value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]).optional(),
  })
  .superRefine((condition, context) => {
    const unary = condition.operator === "exists" || condition.operator === "not_exists";
    if (!unary && condition.value === undefined) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "This operator requires a comparison value.",
      });
    }
    if (
      (condition.operator === "contains" || condition.operator === "starts_with") &&
      typeof condition.value === "string" &&
      !condition.value.trim()
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Contains and starts-with values cannot be empty.",
      });
    }
  });

export const inventoryAccessRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).default(""),
  roleKey: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  permissions: z.array(z.enum(resourceRulePermissions)).min(1).max(resourceRulePermissions.length),
  conditions: z.array(accessRuleConditionSchema).min(1).max(12),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10_000).default(100),
});

export const inventoryAccessRulePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1_000).optional(),
    roleKey: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
    permissions: z
      .array(z.enum(resourceRulePermissions))
      .min(1)
      .max(resourceRulePermissions.length)
      .optional(),
    conditions: z.array(accessRuleConditionSchema).min(1).max(12).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Provide at least one access-rule change.",
  });
