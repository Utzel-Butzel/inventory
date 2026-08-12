import {
  countInventoryItems,
  InventoryCountLocalizationError,
  prepareInventoryCountImage,
} from "@/lib/ai";
import {
  consumePaidAiRateLimit,
  paidAiRateLimitHeaders,
} from "@/lib/ai-rate-limit";
import { requireIdentity } from "@/lib/api-auth";
import { maxUploadBytes } from "@/lib/storage";
import { inventoryCountInputSchema } from "@/lib/validators";

const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
]);

const noStoreHeaders = { "Cache-Control": "no-store" };

const countImageSizeLimit = () =>
  Math.min(maxUploadBytes(), 25 * 1_024 * 1_024);

const json = (
  body: Record<string, unknown>,
  options: { status?: number; headers?: Record<string, string> } = {},
) =>
  Response.json(body, {
    status: options.status,
    headers: { ...noStoreHeaders, ...options.headers },
  });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Dense photos require two independently tool-verified localization passes.
export const maxDuration = 300;

export async function POST(request: Request) {
  const authorization = await requireIdentity(request, "ai");
  if (authorization.response) return authorization.response;

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return json(
      { error: "Expected a multipart image upload." },
      { status: 415 },
    );
  }

  const imageSizeLimit = countImageSizeLimit();
  const contentLengthValue = request.headers.get("content-length");
  if (contentLengthValue !== null) {
    const contentLength = Number(contentLengthValue);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      return json({ error: "Invalid Content-Length header." }, { status: 400 });
    }
    // Leave room for the multipart boundary and the optional text field while
    // rejecting obviously oversized requests before buffering the form body.
    if (contentLength > imageSizeLimit + 512 * 1_024) {
      return json(
        { error: "The image exceeds the upload size limit." },
        { status: 413 },
      );
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid multipart upload." }, { status: 400 });
  }

  const imageEntries = form.getAll("image");
  if (imageEntries.length !== 1 || !(imageEntries[0] instanceof File)) {
    return json(
      { error: "Upload exactly one image in the image field." },
      { status: 422 },
    );
  }
  const image = imageEntries[0];
  if (!image.size) {
    return json({ error: "The image is empty." }, { status: 422 });
  }
  if (image.size > imageSizeLimit) {
    return json(
      { error: "The image exceeds the upload size limit." },
      { status: 413 },
    );
  }
  const normalizedMimeType = image.type.split(";", 1)[0].trim().toLowerCase();
  if (!supportedImageTypes.has(normalizedMimeType)) {
    return json(
      {
        error: `Unsupported image type (${normalizedMimeType || "unknown"}).`,
      },
      { status: 415 },
    );
  }

  const hintEntries = form.getAll("itemHint");
  if (
    hintEntries.length > 1 ||
    (hintEntries.length === 1 && typeof hintEntries[0] !== "string")
  ) {
    return json({ error: "itemHint must be a single text field." }, { status: 422 });
  }
  const rawHint = hintEntries[0];
  const parsed = inventoryCountInputSchema.safeParse({
    itemHint:
      typeof rawHint === "string" && rawHint.trim() ? rawHint : undefined,
  });
  if (!parsed.success) {
    return json(
      { error: "Invalid count request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  let imageDataUrl: string;
  try {
    imageDataUrl = await prepareInventoryCountImage(
      Buffer.from(await image.arrayBuffer()),
    );
  } catch {
    return json(
      { error: "The uploaded file is not a readable, supported image." },
      { status: 422 },
    );
  }

  let limit;
  try {
    limit = await consumePaidAiRateLimit({
      operation: "count",
      identity: authorization.identity,
    });
  } catch (error) {
    console.error("Unable to check the AI counting rate limit.", error);
    return json(
      { error: "AI rate limiting is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (!limit.allowed) {
    return json(
      {
        error: limit.disabled
          ? "AI photo counting is disabled by the administrator."
          : "AI request limit reached. Try again shortly.",
      },
      { status: 429, headers: paidAiRateLimitHeaders(limit) },
    );
  }

  try {
    const { result, model } = await countInventoryItems({
      imageDataUrl,
      itemHint: parsed.data.itemHint,
    });
    return json({ ...result, model });
  } catch (error) {
    if (error instanceof InventoryCountLocalizationError) {
      return json({ error: error.message }, { status: 502 });
    }
    return json(
      { error: "Unable to count items in this image." },
      { status: 502 },
    );
  }
}
