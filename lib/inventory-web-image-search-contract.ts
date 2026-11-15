import { z } from "zod";

// Structured Outputs does not support the "uri" format emitted by .url().
// A refinement keeps URL validation in the SDK response parser without
// adding an unsupported format to the schema sent to the API.
const urlValidator = z.string().url();
const webImageUrlSchema = z.string().max(4_096).refine(
  (value) => urlValidator.safeParse(value).success,
  { message: "Invalid URL" },
);

export const inventoryWebImageSearchResultSchema = z.object({
  candidate: z
    .object({
      imageUrl: webImageUrlSchema,
      sourcePageUrl: webImageUrlSchema,
      title: z.string().trim().min(1).max(240),
      altText: z.string().trim().min(1).max(500),
      attribution: z.string().trim().max(500),
      license: z.string().trim().max(240),
      confidence: z.number().min(0).max(1),
    })
    .nullable(),
});

