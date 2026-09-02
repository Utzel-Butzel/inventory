import { z } from "zod";

import { scanCodeTypes } from "@/lib/scan-code-types";
import {
  scanRegexGroupIsValid,
  scanRegexLimits,
  scanRegexValidationError,
} from "@/lib/scan-regex";

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
  extractedFields: 24,
  inputFields: 24,
  optionsPerField: 40,
} as const;

export const scanWorkflowStorageTargets = [
  "custom-field",
  "metadata",
  "execution",
] as const;

export const scanWorkflowInputTypes = [
  "text",
  "textarea",
  "number",
  "checkbox",
  "select",
  "radio",
  "media",
  "file",
] as const;

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
  z
    .object({
      mode: z.literal("regex"),
      pattern: z.string().min(1).max(scanRegexLimits.pattern),
      flags: z.string().max(scanRegexLimits.flags).optional().default(""),
      group: z
        .string()
        .min(1)
        .max(scanRegexLimits.group)
        .refine(scanRegexGroupIsValid, "Capture group must be a number or name."),
    })
    .strict()
    .superRefine((value, context) => {
      const error = scanRegexValidationError(value.pattern, value.flags);
      if (error) {
        context.addIssue({ code: "custom", path: ["pattern"], message: error });
      }
    }),
]);

export const scanWorkflowFixedPropertySchema = z
  .object({
    key: scanWorkflowPropertyKeySchema,
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().max(240),
    storage: z.enum(scanWorkflowStorageTargets).optional().default("metadata"),
  })
  .strict();

export const scanWorkflowExtractedFieldSchema = z
  .object({
    key: scanWorkflowPropertyKeySchema,
    label: z.string().trim().min(1).max(120),
    extraction: scanWorkflowExtractionSchema,
    storage: z.enum(scanWorkflowStorageTargets).optional().default("custom-field"),
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
    type: z.enum(scanWorkflowInputTypes).optional().default("select"),
    storage: z.enum(scanWorkflowStorageTargets).optional().default("metadata"),
    placeholder: z.string().trim().max(240).optional().default(""),
    options: z
      .array(scanWorkflowSelectOptionSchema)
      .max(scanWorkflowLimits.optionsPerField)
      .optional()
      .default([]),
  })
  .strict()
  .superRefine((field, context) => {
    if (
      (field.type === "select" || field.type === "radio") &&
      field.options.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Select and radio fields need at least one option.",
      });
    }
    if (
      (field.type === "media" || field.type === "file") &&
      field.storage !== "execution"
    ) {
      context.addIssue({
        code: "custom",
        path: ["storage"],
        message: "Media and file fields must be stored with the flow execution.",
      });
    }
    const values = field.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Option values must be unique within a field.",
      });
    }
  });

export const scanWorkflowOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unit") }).strict(),
  z
    .object({
      type: z.literal("stock-adjustment"),
      delta: z.number().int().min(-1_000_000).max(1_000_000).refine(Boolean, {
        message: "Stock adjustment must not be zero.",
      }),
    })
    .strict(),
  z
    .object({
      type: z.literal("assembly-build"),
      quantity: z.number().int().min(1).max(1_000),
    })
    .strict(),
]);

const workflowEditableShape = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5_000),
  enabled: z.boolean(),
  resourceId: z.string().uuid(),
  codeTypes: z
    .array(z.enum(scanCodeTypes))
    .min(1)
    .max(scanCodeTypes.length)
    .refine(
      (values) => new Set(values).size === values.length,
      "Code types must be unique.",
    ),
  extraction: scanWorkflowExtractionSchema,
  identifierPropertyKey: scanWorkflowPropertyKeySchema,
  identifierStorage: z
    .enum(scanWorkflowStorageTargets)
    .optional()
    .default("metadata"),
  extractedFields: z
    .array(scanWorkflowExtractedFieldSchema)
    .max(scanWorkflowLimits.extractedFields),
  operation: scanWorkflowOperationSchema,
  createMissingUnit: z.boolean(),
  unitStatus: z.enum(scanWorkflowUnitStatuses).nullable(),
  fixedProperties: z
    .array(scanWorkflowFixedPropertySchema)
    .max(scanWorkflowLimits.fixedProperties),
  inputFields: z
    .array(scanWorkflowInputFieldSchema)
    .max(scanWorkflowLimits.inputFields),
  triggerWebhook: z.boolean(),
  webhookEventName: z.string().trim().min(1).max(120),
};

const validateWorkflowPropertyKeys = (
  value: {
    identifierPropertyKey: string;
    extractedFields: Array<{ key: string }>;
    fixedProperties: Array<{ key: string }>;
    inputFields: Array<{ key: string }>;
  },
  context: z.RefinementCtx,
) => {
  const keys = [
    value.identifierPropertyKey,
    ...value.extractedFields.map((field) => field.key),
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
    codeTypes: workflowEditableShape.codeTypes
      .optional()
      .default([...scanCodeTypes]),
    extraction: workflowEditableShape.extraction,
    identifierPropertyKey: workflowEditableShape.identifierPropertyKey,
    identifierStorage: workflowEditableShape.identifierStorage,
    extractedFields: workflowEditableShape.extractedFields.optional().default([]),
    operation: workflowEditableShape.operation.optional().default({ type: "unit" }),
    createMissingUnit:
      workflowEditableShape.createMissingUnit.optional().default(false),
    unitStatus: workflowEditableShape.unitStatus.optional().default(null),
    fixedProperties: workflowEditableShape.fixedProperties.optional().default([]),
    inputFields: workflowEditableShape.inputFields.optional().default([]),
    triggerWebhook: workflowEditableShape.triggerWebhook.optional().default(false),
    webhookEventName: workflowEditableShape.webhookEventName
      .optional()
      .default("inventory.action.executed"),
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
    codeTypes: workflowEditableShape.codeTypes.optional(),
    extraction: workflowEditableShape.extraction.optional(),
    identifierPropertyKey: workflowEditableShape.identifierPropertyKey.optional(),
    identifierStorage: workflowEditableShape.identifierStorage.optional(),
    extractedFields: workflowEditableShape.extractedFields.optional(),
    operation: workflowEditableShape.operation.optional(),
    createMissingUnit: workflowEditableShape.createMissingUnit.optional(),
    unitStatus: workflowEditableShape.unitStatus.optional(),
    fixedProperties: workflowEditableShape.fixedProperties.optional(),
    inputFields: workflowEditableShape.inputFields.optional(),
    triggerWebhook: workflowEditableShape.triggerWebhook.optional(),
    webhookEventName: workflowEditableShape.webhookEventName.optional(),
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
    codeType: z.enum(scanCodeTypes).nullable().optional().default(null),
  })
  .strict();

export const stockScanExecuteSchema = z
  .object({
    workflowId: z.string().uuid(),
    revision: z.number().int().min(1),
    code: z.string().trim().min(1).max(scanWorkflowLimits.scannedValue),
    codeType: z.enum(scanCodeTypes).nullable().optional().default(null),
    expectedResourceUpdatedAt: z.string().datetime(),
    expectedUnitId: z.string().uuid().nullable(),
    expectedUnitUpdatedAt: z.string().datetime().nullable(),
    inputs: z
      .record(
        z.string().min(1).max(80),
        z.union([
          z.string().max(20_000),
          z.number().finite(),
          z.boolean(),
          z.array(z.string().max(2_048)).max(12),
        ]),
      )
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

export const scanExtractionSuggestionRequestSchema = z
  .object({
    sampleCode: z.string().min(1).max(scanWorkflowLimits.scannedValue),
    codeType: z.enum(scanCodeTypes).nullable().optional().default(null),
    desiredValue: z.string().trim().max(scanWorkflowLimits.identifier).optional(),
    instruction: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.desiredValue || value.instruction),
    "Select the desired value or describe what should be extracted.",
  );

export type ScanWorkflowExtraction = z.infer<
  typeof scanWorkflowExtractionSchema
>;
export type ScanWorkflowFixedProperty = z.infer<
  typeof scanWorkflowFixedPropertySchema
>;
export type ScanWorkflowExtractedField = z.infer<
  typeof scanWorkflowExtractedFieldSchema
>;
export type ScanWorkflowInputField = z.infer<
  typeof scanWorkflowInputFieldSchema
>;
export type ScanWorkflowOperation = z.infer<typeof scanWorkflowOperationSchema>;
export type ScanWorkflowCreateInput = z.infer<typeof scanWorkflowCreateSchema>;
export type ScanWorkflowPatchInput = z.infer<typeof scanWorkflowPatchSchema>;
export type StockScanResolveInput = z.infer<typeof stockScanResolveSchema>;
export type StockScanExecuteInput = z.infer<typeof stockScanExecuteSchema>;
export type ScanExtractionSuggestionRequest = z.infer<
  typeof scanExtractionSuggestionRequestSchema
>;

export type ScanWorkflowDto = ScanWorkflowCreateInput & {
  id: string;
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
