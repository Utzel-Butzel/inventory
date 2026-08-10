import { z } from "zod";

export const scanWorkflowUnitStatuses = [
  "available",
  "reserved",
  "in-use",
  "maintenance",
  "consumed",
  "lost",
  "retired",
] as const;

export const scanWorkflowLimits = {
  scannedValue: 2_048,
  identifier: 180,
  fixedProperties: 24,
  inputFields: 12,
  optionsPerField: 40,
} as const;

const propertyKeyCharacters =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-";

export const scanWorkflowPropertyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) => [...value].every((character) => propertyKeyCharacters.includes(character)),
    "Property keys may only contain letters, numbers, underscore, dash, and dot.",
  );

const exactOriginSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((value) => {
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  }, "sourceOrigin must be an exact URL origin such as https://example.com.");

const exactPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      value.startsWith("/") && !value.includes("?") && !value.includes("#"),
    "sourcePath must be an exact URL path beginning with /.",
  );

export const scanWorkflowExtractionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("full") }).strict(),
  z
    .object({
      mode: z.literal("url-query"),
      parameter: z.string().trim().min(1).max(80),
      sourceOrigin: exactOriginSchema.optional(),
      sourcePath: exactPathSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("prefix"),
      prefix: z.string().min(1).max(160),
    })
    .strict(),
]);

export const scanWorkflowFixedPropertySchema = z
  .object({
    key: scanWorkflowPropertyKeySchema,
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().max(240),
  })
  .strict();

export const scanWorkflowSelectOptionSchema = z
  .object({
    value: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    color: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export const scanWorkflowInputFieldSchema = z
  .object({
    key: scanWorkflowPropertyKeySchema,
    label: z.string().trim().min(1).max(120),
    required: z.boolean(),
    options: z
      .array(scanWorkflowSelectOptionSchema)
      .min(1)
      .max(scanWorkflowLimits.optionsPerField),
  })
  .strict()
  .superRefine((field, context) => {
    const values = field.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Option values must be unique within a field.",
      });
    }
  });

const workflowEditableShape = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5_000),
  enabled: z.boolean(),
  resourceId: z.string().uuid(),
  extraction: scanWorkflowExtractionSchema,
  identifierPropertyKey: scanWorkflowPropertyKeySchema,
  createMissingUnit: z.boolean(),
  unitStatus: z.enum(scanWorkflowUnitStatuses).nullable(),
  fixedProperties: z
    .array(scanWorkflowFixedPropertySchema)
    .max(scanWorkflowLimits.fixedProperties),
  inputFields: z
    .array(scanWorkflowInputFieldSchema)
    .max(scanWorkflowLimits.inputFields),
};

const validateWorkflowPropertyKeys = (
  value: {
    identifierPropertyKey: string;
    fixedProperties: Array<{ key: string }>;
    inputFields: Array<{ key: string }>;
  },
  context: z.RefinementCtx,
) => {
  const keys = [
    value.identifierPropertyKey,
    ...value.fixedProperties.map((property) => property.key),
    ...value.inputFields.map((field) => field.key),
  ];
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: "custom",
      message:
        "The identifier, fixed properties, and input fields must use distinct property keys.",
    });
  }
};

export const scanWorkflowCreateSchema = z
  .object({
    name: workflowEditableShape.name,
    description: workflowEditableShape.description.optional().default(""),
    enabled: workflowEditableShape.enabled.optional().default(true),
    resourceId: workflowEditableShape.resourceId,
    extraction: workflowEditableShape.extraction,
    identifierPropertyKey: workflowEditableShape.identifierPropertyKey,
    createMissingUnit:
      workflowEditableShape.createMissingUnit.optional().default(false),
    unitStatus: workflowEditableShape.unitStatus.optional().default(null),
    fixedProperties: workflowEditableShape.fixedProperties.optional().default([]),
    inputFields: workflowEditableShape.inputFields.optional().default([]),
  })
  .strict()
  .superRefine(validateWorkflowPropertyKeys);

export const scanWorkflowPatchSchema = z
  .object({
    revision: z.number().int().min(1),
    name: workflowEditableShape.name.optional(),
    description: workflowEditableShape.description.optional(),
    enabled: workflowEditableShape.enabled.optional(),
    resourceId: workflowEditableShape.resourceId.optional(),
    extraction: workflowEditableShape.extraction.optional(),
    identifierPropertyKey: workflowEditableShape.identifierPropertyKey.optional(),
    createMissingUnit: workflowEditableShape.createMissingUnit.optional(),
    unitStatus: workflowEditableShape.unitStatus.optional(),
    fixedProperties: workflowEditableShape.fixedProperties.optional(),
    inputFields: workflowEditableShape.inputFields.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "revision"),
    "Provide at least one workflow change.",
  );

export const stockScanResolveSchema = z
  .object({
    workflowId: z.string().uuid(),
    code: z.string().trim().min(1).max(scanWorkflowLimits.scannedValue),
  })
  .strict();

export const stockScanExecuteSchema = z
  .object({
    workflowId: z.string().uuid(),
    revision: z.number().int().min(1),
    code: z.string().trim().min(1).max(scanWorkflowLimits.scannedValue),
    expectedResourceUpdatedAt: z.string().datetime(),
    expectedUnitId: z.string().uuid().nullable(),
    expectedUnitUpdatedAt: z.string().datetime().nullable(),
    inputs: z
      .record(z.string().min(1).max(80), z.string().max(240))
      .refine(
        (value) => Object.keys(value).length <= scanWorkflowLimits.inputFields,
        `At most ${scanWorkflowLimits.inputFields} inputs are allowed.`,
      )
      .optional()
      .default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.expectedUnitId === null) !== (value.expectedUnitUpdatedAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["expectedUnitUpdatedAt"],
        message:
          "expectedUnitId and expectedUnitUpdatedAt must either both be null or both identify the resolved unit.",
      });
    }
  });

export type ScanWorkflowExtraction = z.infer<
  typeof scanWorkflowExtractionSchema
>;
export type ScanWorkflowFixedProperty = z.infer<
  typeof scanWorkflowFixedPropertySchema
>;
export type ScanWorkflowInputField = z.infer<
  typeof scanWorkflowInputFieldSchema
>;
export type ScanWorkflowCreateInput = z.infer<typeof scanWorkflowCreateSchema>;
export type ScanWorkflowPatchInput = z.infer<typeof scanWorkflowPatchSchema>;
export type StockScanResolveInput = z.infer<typeof stockScanResolveSchema>;
export type StockScanExecuteInput = z.infer<typeof stockScanExecuteSchema>;

export type ScanWorkflowDto = ScanWorkflowCreateInput & {
  id: string;
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
