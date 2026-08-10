import { z } from "zod";

import { resourceTypes, userRoles } from "@/db/schema";

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

const resourceShape = {
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().max(20_000),
  type: z.enum(resourceTypes),
  status: z.enum(["available", "in-use", "maintenance", "archived"]),
  sku: nullableText(80),
  quantity: z.coerce.number().int().min(0).max(1_000_000),
  location: nullableText(240),
  serialNumber: nullableText(180),
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
  relatedResourceIds: z.array(z.string().uuid()).max(100),
  gpsLatitude: z.coerce.number().min(-90).max(90).nullable(),
  gpsLongitude: z.coerce.number().min(-180).max(180).nullable(),
  gpsAltitude: z.coerce.number().min(-12_000).max(100_000).nullable(),
  notes: z.string().trim().max(20_000),
};

export const resourceInputSchema = z.object({
  ...resourceShape,
  description: resourceShape.description.optional().default(""),
  type: resourceShape.type.optional().default("object"),
  status: resourceShape.status.optional().default("available"),
  sku: resourceShape.sku.optional(),
  quantity: resourceShape.quantity.optional().default(1),
  location: resourceShape.location.optional(),
  serialNumber: resourceShape.serialNumber.optional(),
  valueCents: resourceShape.valueCents.optional(),
  currency: resourceShape.currency.optional().default("EUR"),
  priority: resourceShape.priority.optional().default(3),
  tags: resourceShape.tags.optional().default([]),
  categories: resourceShape.categories.optional().default([]),
  relatedResourceIds: resourceShape.relatedResourceIds.optional().default([]),
  gpsLatitude: resourceShape.gpsLatitude.optional(),
  gpsLongitude: resourceShape.gpsLongitude.optional(),
  gpsAltitude: resourceShape.gpsAltitude.optional(),
  notes: resourceShape.notes.optional().default(""),
});

// Build the PATCH validator from validators without defaults. Calling .partial()
// on resourceInputSchema would otherwise materialize defaults (including
// quantity: 1) for fields the client did not send.
export const resourcePatchSchema = z.object(resourceShape).partial();

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
});

export const coverInputSchema = z.object({
  sourceMediaId: z.string().uuid().optional(),
  prompt: z.string().trim().max(5_000).optional(),
});

export const inventoryCountInputSchema = z
  .object({
    itemHint: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const userCreateInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  name: z.string().trim().min(1).max(160),
  password: passwordSchema,
  role: z.enum(userRoles).default("editor"),
});

export const userUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    role: z.enum(userRoles).optional(),
    isActive: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Provide at least one user change.",
  });
