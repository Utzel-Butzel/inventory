import { z } from "zod";

import type {
  CustomFieldDefinition,
  CustomFieldValue,
  CustomFieldValues,
} from "@/lib/custom-field-contract";

export const publicShareScopes = ["inventory", "item"] as const;
export type PublicShareScope = (typeof publicShareScopes)[number];
export const publicShareAccessModes = ["view", "stock"] as const;
export type PublicShareAccessMode = (typeof publicShareAccessModes)[number];
export const publicShareIdSchema = z.string().uuid();

export type PublicShareFilter = {
  fieldKey: string;
  value: CustomFieldValue;
};

const customFieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

const publicShareFilterValueSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(120)).max(100),
]);

export const publicShareFilterSchema = z
  .object({
    fieldKey: customFieldKeySchema,
    value: publicShareFilterValueSchema,
  })
  .strict();

export const publicShareCreateSchema = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("inventory"),
      name: z.string().trim().min(1).max(120),
      filter: publicShareFilterSchema.optional().nullable(),
      accessMode: z.enum(publicShareAccessModes).optional().default("view"),
      password: z.string().min(8).max(128).optional(),
    })
    .strict(),
  z
    .object({
      scope: z.literal("item"),
      name: z.string().trim().min(1).max(120),
      resourceId: z.string().uuid(),
    })
    .strict(),
]).superRefine((value, context) => {
  if (value.scope !== "inventory") return;
  if (value.accessMode === "stock" && !value.password) {
    context.addIssue({
      code: "custom",
      path: ["password"],
      message: "A stock-tool share requires a password.",
    });
  }
  if (value.accessMode === "view" && value.password !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["password"],
      message: "Read-only shares do not use a password.",
    });
  }
});

export type PublicShareCreateInput = z.infer<typeof publicShareCreateSchema>;

export const publicStockBookingSchema = z
  .object({
    action: z.enum(["in", "out"]),
    quantity: z.number().int().min(1).max(1_000_000),
    note: z.string().trim().max(2_000).optional().default(""),
  })
  .strict();

export type PublicStockBookingInput = z.infer<typeof publicStockBookingSchema>;

export function matchesPublicShareFilter(
  customFields: CustomFieldValues,
  filter: PublicShareFilter | null,
) {
  if (!filter) return true;
  return JSON.stringify(customFields[filter.fieldKey]) === JSON.stringify(filter.value);
}

export function isPublicShareFilterValueCompatible(
  definition: Pick<
    CustomFieldDefinition,
    | "fieldType"
    | "options"
    | "referenceMultiple"
    | "minValue"
    | "maxValue"
    | "step"
  >,
  value: CustomFieldValue,
) {
  if (definition.fieldType === "boolean") return typeof value === "boolean";
  if (definition.fieldType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (definition.minValue !== null && value < definition.minValue) return false;
    if (definition.maxValue !== null && value > definition.maxValue) return false;
    if (definition.step !== null) {
      const quotient = (value - (definition.minValue ?? 0)) / definition.step;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-8) return false;
    }
    return true;
  }
  if (definition.fieldType === "multi_select") {
    return (
      Array.isArray(value) &&
      value.length <= 100 &&
      new Set(value).size === value.length &&
      value.every((entry) =>
        definition.options.some((option) => option.value === entry),
      )
    );
  }
  if (definition.fieldType === "reference") {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (definition.referenceMultiple) {
      return (
        Array.isArray(value) &&
        value.length <= 100 &&
        new Set(value).size === value.length &&
        value.every((entry) => uuid.test(entry))
      );
    }
    return typeof value === "string" && uuid.test(value);
  }
  if (typeof value !== "string") return false;
  const maximumLength = definition.fieldType === "textarea" ? 20_000 : 2_048;
  if (value.length > maximumLength) return false;
  if (definition.fieldType === "select") {
    return definition.options.some((option) => option.value === value);
  }
  if (definition.fieldType === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return (
      date.getUTCFullYear() === Number(match[1]) &&
      date.getUTCMonth() === Number(match[2]) - 1 &&
      date.getUTCDate() === Number(match[3])
    );
  }
  if (definition.fieldType === "datetime") {
    return value.includes("T") && !Number.isNaN(new Date(value).getTime());
  }
  if (definition.fieldType === "email") {
    return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  if (definition.fieldType === "url") {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
  return true;
}
