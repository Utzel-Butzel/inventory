import { z } from "zod";

export const contactRoles = ["customer", "supplier"] as const;
export type ContactRole = (typeof contactRoles)[number];

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const contactFields = {
  name: z.string().trim().min(1).max(240),
  company: optionalText(240),
  roles: z.array(z.enum(contactRoles)).min(1).max(10),
  email: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
  phone: optionalText(80),
  website: z.string().trim().url().max(2_048).nullable().optional(),
  customerNumber: optionalText(80),
  supplierNumber: optionalText(80),
  taxId: optionalText(80),
  addressLine1: optionalText(240),
  addressLine2: optionalText(240),
  postalCode: optionalText(32),
  city: optionalText(120),
  state: optionalText(120),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  notes: z.string().max(20_000).optional(),
  resourceIds: z.array(z.string().uuid()).max(500).optional(),
};

const contactObjectSchema = z.object(contactFields).strict();

export const contactInputSchema = contactObjectSchema
  .transform((value) => ({
    ...value,
    roles: Array.from(new Set(value.roles)),
    tags: Array.from(new Set(value.tags ?? [])),
    resourceIds: Array.from(new Set(value.resourceIds ?? [])),
  }));

export const contactPatchSchema = contactObjectSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one contact field is required.",
  })
  .transform((value) => ({
    ...value,
    ...(value.roles ? { roles: Array.from(new Set(value.roles)) } : {}),
    ...(value.tags ? { tags: Array.from(new Set(value.tags)) } : {}),
    ...(value.resourceIds
      ? { resourceIds: Array.from(new Set(value.resourceIds)) }
      : {}),
  }));

export const contactRoleFilterSchema = z.enum(contactRoles);

export type ContactInput = z.infer<typeof contactInputSchema>;
export type ContactPatch = z.infer<typeof contactPatchSchema>;
