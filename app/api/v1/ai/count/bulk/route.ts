import { createHash } from "node:crypto";

import { prepareInventoryCountImage } from "@/lib/ai";
import { aiUsageEstimate } from "@/lib/ai-billing";
import { claimAiOperation, finishAiOperation, releaseAiOperation } from "@/lib/ai-idempotency";
import { getAiPromptSettings } from "@/lib/ai-prompt-store";
import { consumePaidAiRateLimit, paidAiRateLimitHeaders } from "@/lib/ai-rate-limit";
import { AiMonthlyBudgetExceededError, aiBudgetErrorBody, trackAiUsage } from "@/lib/ai-usage";
import { hashRequestIdentity, requirePermission, requireResourcePermission } from "@/lib/api-auth";
import { MultipartBodyTooLargeError, readBoundedMultipart } from "@/lib/bounded-multipart";
import { hashIdempotentPayload, readIdempotencyKey } from "@/lib/idempotency";
import {
  bulkCountInputSchema,
  bulkCountMethodVersion,
  minimumBulkCountImages,
  maximumBulkCountImages,
  maximumBulkCountImageBytes,
  maximumBulkCountUploadBytes,
} from "@/lib/inventory-bulk-count";
import { estimateBulkInventoryItems } from "@/lib/inventory-bulk-count-ai";
import { maxUploadBytes } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 120;

const json = (body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "ai.count");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) return json({ error: "Idempotency-Key is required.", code: "invalidRequest" }, 400);

  let form: FormData;
  try {
    form = await readBoundedMultipart(request, Math.min(maximumBulkCountUploadBytes, maxUploadBytes()));
  } catch (error) {
    return json({ error: "Invalid or oversized image upload.", code: "upload" }, error instanceof MultipartBodyTooLargeError ? 413 : 400);
  }
  const inputs = form.getAll("input");
  let rawInput: unknown;
  try {
    if (inputs.length !== 1 || typeof inputs[0] !== "string") throw new Error("Invalid input.");
    rawInput = JSON.parse(inputs[0]);
  } catch {
    return json({ error: "Expected one JSON input field.", code: "invalidRequest" }, 422);
  }
  const parsed = bulkCountInputSchema.safeParse(rawInput);
  if (!parsed.success) return json({ error: "Invalid bulk estimate request.", code: "invalidRequest" }, 422);
  // Validate tenant and item access before attaching usage to a resource ID.
  const itemAuthorization = await requireResourcePermission(request, "ai.count", parsed.data.itemId);
  if (itemAuthorization.response) return itemAuthorization.response;

  const images = form.getAll("images");
  if (images.length < minimumBulkCountImages || images.length > maximumBulkCountImages || images.some((image) =>
    !(image instanceof File) || !image.size || image.size > maximumBulkCountImageBytes || !supportedTypes.has(image.type.toLowerCase()),
  )) return json({ error: "Upload 3–5 supported images, at most 8 MiB each.", code: "upload" }, 422);

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return json({ error: "Image analysis is not configured.", code: "notConfigured" }, 503);
  }

  let model: string;
  try {
    const settings = await getAiPromptSettings(authorization.identity.organizationId);
    model = process.env.OPENAI_BULK_COUNT_MODEL?.trim() || settings.inventorySettings.analysisModel;
  } catch {
    return json({ error: "AI settings are unavailable.", code: "unavailable" }, 503);
  }
  const bytes = await Promise.all((images as File[]).map(async (image) => Buffer.from(await image.arrayBuffer())));
  const imageHashes = bytes.map((image) => createHash("sha256").update(image).digest("hex"));
  if (new Set(imageHashes).size !== imageHashes.length) {
    return json({ error: "Use distinct views, not duplicate files.", code: "duplicatePhotos" }, 422);
  }
  const requestHash = hashIdempotentPayload({
    method: bulkCountMethodVersion,
    actor: hashRequestIdentity(authorization.identity),
    input: parsed.data,
    model,
    images: imageHashes,
  });

  let claim;
  try {
    claim = await claimAiOperation({
      organizationId: authorization.identity.organizationId,
      operation: "count",
      idempotencyKey: idempotency.key,
      resourceId: parsed.data.itemId,
      requestHash,
    });
  } catch {
    return json({ error: "Retry protection is unavailable.", code: "unavailable" }, 503);
  }
  if (claim.kind === "conflict") return json({ error: "This attempt belongs to different inputs.", code: "conflict" }, 409);
  if (claim.kind === "processing") return json({ error: "The analysis is still processing. Retry the same request.", code: "processing" }, 409, { "Retry-After": "3" });
  if (claim.kind === "replay") return json(claim.operation.response ?? {}, claim.operation.responseStatus ?? 500, claim.operation.responseHeaders);

  const operationId = claim.operationId;
  const release = () => releaseAiOperation(authorization.identity.organizationId, operationId).catch(() => undefined);
  const finish = async (body: Record<string, unknown>, status = 200) => {
    // Retain the claim if persistence fails: retries must not start a second
    // paid analysis while the first outcome is ambiguous.
    await finishAiOperation({ organizationId: authorization.identity.organizationId, operationId, body, status })
      .catch(() => console.error("Unable to persist the bulk estimate response."));
    return json(body, status);
  };

  let dataUrls: string[];
  try {
    dataUrls = [];
    // Bound decode memory by normalizing images sequentially.
    for (const image of bytes) dataUrls.push((await prepareInventoryCountImage(image)).dataUrl);
  } catch {
    await release();
    return json({ error: "An image could not be decoded.", code: "upload" }, 422);
  }
  let limit;
  try {
    limit = await consumePaidAiRateLimit({ organizationId: authorization.identity.organizationId, identity: authorization.identity, operation: "count" });
  } catch {
    await release();
    return json({ error: "Rate limiting is unavailable.", code: "unavailable" }, 503);
  }
  if (!limit.allowed) {
    await release();
    return json({ error: "Counting is disabled or the request limit has been reached.", code: limit.disabled ? "disabled" : "rateLimit" }, 429, paidAiRateLimitHeaders(limit));
  }
  let providerAttempted = false;
  try {
    const result = await trackAiUsage({
      organizationId: authorization.identity.organizationId,
      actor: authorization.identity,
      resourceId: parsed.data.itemId,
      estimate: aiUsageEstimate({ action: "photo_count", provider: "openai", model }),
      metadata: { method: bulkCountMethodVersion, imageCount: images.length, analysisPasses: 2 },
      run: () => {
        providerAttempted = true;
        return estimateBulkInventoryItems({ input: parsed.data, images: dataUrls, model, idempotencyKey: operationId });
      },
    });
    return finish(result);
  } catch (error) {
    if (!providerAttempted) await release();
    if (error instanceof AiMonthlyBudgetExceededError) return json({ ...aiBudgetErrorBody(error), code: "budget" }, 402);
    if (!providerAttempted) return json({ error: "Usage accounting is unavailable.", code: "unavailable" }, 503);
    console.error("Bulk estimate failed:", error instanceof Error ? error.name : "unknown");
    return finish({ error: "The image analysis returned no usable estimate.", code: "analysisFailed", terminal: true }, 502);
  }
}
