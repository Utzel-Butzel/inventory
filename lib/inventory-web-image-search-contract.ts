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


export function webImageLicenseInstructions(ignoreLicense = false) {
  return ignoreLicense
    ? `- Do not filter images by license or reuse permission. Prefer official manufacturer product images.
- A missing or unclear license must not exclude an otherwise accurate match.
- Still return the source page and any known attribution and license. Use an empty string when unknown; never invent permission.
- Use candidate: null only when no reliable matching image with a direct HTTPS image URL is found.`
    : `- Prefer Wikimedia Commons, an official manufacturer media page with clear reuse terms, or another source that explicitly permits reuse.
- Exclude images whose reuse rights cannot be identified.
- Use candidate: null when there is no reliable, reusable match.`;
}

export class InventoryWebImageNotFoundError extends Error {
  readonly code: string;

  constructor(ignoreLicense = false) {
    super(ignoreLicense
      ? "No matching image with a direct image URL was found. Try a more precise brand and model or upload an image."
      : "No matching image with confirmed reuse rights was found. Refine your search, enable Ignore license to include images with unclear rights, or upload an image.");
    this.name = "InventoryWebImageNotFoundError";
    this.code = ignoreLicense ? "AI_IMAGE_NOT_FOUND" : "AI_REUSABLE_IMAGE_NOT_FOUND";
  }
}
