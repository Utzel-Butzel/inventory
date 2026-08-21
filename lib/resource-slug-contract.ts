import { z } from "zod";

export const MAX_RESOURCE_SLUGS = 20;
export const RESOURCE_SLUG_MAX_LENGTH = 80;
export const RESOURCE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RESOURCE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const normalizeResourceSlug = (value: string) =>
  value.trim().toLowerCase();

export const resourceSlugSchema = z
  .string()
  .transform(normalizeResourceSlug)
  .pipe(
    z
      .string()
      .min(1, "Slugs cannot be empty.")
      .max(
        RESOURCE_SLUG_MAX_LENGTH,
        `Slugs must not exceed ${RESOURCE_SLUG_MAX_LENGTH} characters.`,
      )
      .regex(
        RESOURCE_SLUG_PATTERN,
        "Slugs may contain only lowercase letters, numbers, and single dashes.",
      )
      .refine((value) => value !== "new", {
        message: 'The slug "new" is reserved.',
      })
      .refine((value) => !RESOURCE_UUID_PATTERN.test(value), {
        message: "Slugs cannot use the UUID format reserved for item IDs.",
      }),
  );

export const resourceSlugsSchema = z
  .array(resourceSlugSchema)
  .max(MAX_RESOURCE_SLUGS)
  .superRefine((slugs, context) => {
    const seen = new Set<string>();
    slugs.forEach((slug, index) => {
      if (seen.has(slug)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Each slug must be unique for this item.",
        });
      }
      seen.add(slug);
    });
  });

export const isResourceUuid = (value: string) =>
  RESOURCE_UUID_PATTERN.test(value);

export const primaryResourceReference = (resource: {
  id: string;
  slugs?: readonly string[];
}) => resource.slugs?.[0] ?? resource.id;

export const isResourceSlugConflict = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { constraint_name?: unknown; message?: unknown };
  return (
    candidate.constraint_name === "resource_slugs_organization_slug_pk" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("resource_slugs_organization_slug_pk"))
  );
};
