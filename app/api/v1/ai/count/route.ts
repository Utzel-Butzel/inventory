import {
  countDenseRepeatedInventoryItems,
  countInventoryItems,
  denseComponentCountModelLabel,
  InventoryCountLocalizationError,
  prepareInventoryCountImage,
} from "@/lib/ai";
import { aiUsageEstimate } from "@/lib/ai-billing";
import { createHash } from "node:crypto";
import {
  AiMonthlyBudgetExceededError,
  aiBudgetErrorBody,
  trackAiUsage,
} from "@/lib/ai-usage";
import {
  consumePaidAiRateLimit,
  paidAiRateLimitHeaders,
} from "@/lib/ai-rate-limit";
import {
  claimAiOperation,
  findAiOperation,
  finishAiOperation,
  releaseAiOperation,
} from "@/lib/ai-idempotency";
import { hashRequestIdentity, requirePermission } from "@/lib/api-auth";
import { hashIdempotentPayload, readIdempotencyKey } from "@/lib/idempotency";
import {
  createReplicateCountJobToken,
  validateReplicateCountJobSigningSecret,
} from "@/lib/replicate-count-job";
import { maxUploadBytes } from "@/lib/storage";
import { inventoryCountInputSchema } from "@/lib/validators";
import {
  isInventoryCountModelId,
  resolveInventoryCountModel,
} from "@/lib/inventory-count-models";

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

class MultipartBodyTooLargeError extends Error {}

async function readBoundedMultipartForm(
  request: Request,
  contentType: string,
  maximumBytes: number,
) {
  if (!request.body) throw new Error("Missing multipart body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new MultipartBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks, total), {
    headers: { "Content-Type": contentType },
  }).formData();
}

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
// The initial call only creates a Replicate prediction. Clients poll the signed
// job token separately, so a cold model never holds this request open for minutes.
export const maxDuration = 30;

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "ai.count");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return json(
      {
        error:
          "Idempotency-Key is required for paid photo counting and must be a UUID.",
      },
      { status: 400 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
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
    form = await readBoundedMultipartForm(
      request,
      contentType,
      imageSizeLimit + 512 * 1_024,
    );
  } catch (error) {
    if (error instanceof MultipartBodyTooLargeError) {
      return json(
        { error: "The image exceeds the upload size limit." },
        { status: 413 },
      );
    }
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
  const modelEntries = form.getAll("modelId");
  if (
    modelEntries.length > 1 ||
    (modelEntries.length === 1 && typeof modelEntries[0] !== "string")
  ) {
    return json({ error: "modelId must be a single text field." }, { status: 422 });
  }
  const rawModelId = modelEntries[0];
  if (
    typeof rawModelId === "string" &&
    rawModelId.trim() &&
    !isInventoryCountModelId(rawModelId.trim())
  ) {
    return json({ error: "The selected counting model is unavailable." }, { status: 422 });
  }
  const countModel = resolveInventoryCountModel(
    typeof rawModelId === "string" && rawModelId.trim()
      ? rawModelId.trim()
      : undefined,
  );
  if (!countModel) {
    return json({ error: "The selected counting model is unavailable." }, { status: 422 });
  }
  const itemIdEntries = form.getAll("itemId");
  if (
    itemIdEntries.length > 1 ||
    (itemIdEntries.length === 1 && typeof itemIdEntries[0] !== "string")
  ) {
    return json({ error: "itemId must be a single text field." }, { status: 422 });
  }
  const itemId =
    typeof itemIdEntries[0] === "string" && itemIdEntries[0].trim()
      ? itemIdEntries[0].trim()
      : null;
  if (
    itemId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      itemId,
    )
  ) {
    return json({ error: "itemId must be a UUID." }, { status: 422 });
  }
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

  const imageBytes = Buffer.from(await image.arrayBuffer());

  let operationId: string | null = null;
  const requestHash = hashIdempotentPayload({
    actor: hashRequestIdentity(authorization.identity),
    imageSha256: createHash("sha256").update(imageBytes).digest("hex"),
    itemHint: parsed.data.itemHint,
    modelId: countModel.id,
    mimeType: normalizedMimeType,
  });
  let claim;
  try {
    claim = await claimAiOperation({
      organizationId: authorization.identity.organizationId,
      operation: "count",
      idempotencyKey: idempotency.key,
      resourceId: itemId ?? idempotency.key,
      requestHash,
    });
  } catch (error) {
    console.error("Unable to claim an idempotent count request.", error);
    return json(
      { error: "Count retry protection is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (claim.kind === "conflict") {
    return json(
      { error: "That Idempotency-Key was already used for another count." },
      { status: 409 },
    );
  }
  if (claim.kind === "replay") {
    return json(claim.operation.response ?? {}, {
      status: claim.operation.responseStatus ?? 500,
      headers: claim.operation.responseHeaders,
    });
  }
  if (claim.kind === "processing") {
    // A prediction may have been accepted moments before its signed 202 was
    // persisted. Briefly wait for that response instead of starting another.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      let current;
      try {
        current = await findAiOperation(
          authorization.identity.organizationId,
          "count",
          idempotency.key,
        );
      } catch (error) {
        console.error("Unable to reload an idempotent count request.", error);
        return json(
          {
            status: "starting",
            error:
              "The counting job is reserved, but its state is temporarily unavailable.",
          },
          { status: 409, headers: { "Retry-After": "2" } },
        );
      }
      if (current?.response && current.responseStatus !== null) {
        return json(current.response, {
          status: current.responseStatus,
          headers: current.responseHeaders,
        });
      }
    }
    return json(
      {
        status: "starting",
        error:
          "This counting attempt is still reserved. Wait briefly, then retry the same photo; no second job will be started.",
      },
      { status: 409, headers: { "Retry-After": "1" } },
    );
  }
  operationId = claim.operationId;

  let limit;
  try {
    limit = await consumePaidAiRateLimit({
      organizationId: authorization.identity.organizationId,
      operation: "count",
      identity: authorization.identity,
    });
  } catch (error) {
    if (operationId) {
      await releaseAiOperation(
        authorization.identity.organizationId,
        operationId,
      ).catch(() => undefined);
    }
    console.error("Unable to check the AI counting rate limit.", error);
    return json(
      { error: "AI rate limiting is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (!limit.allowed) {
    if (operationId) {
      await releaseAiOperation(
        authorization.identity.organizationId,
        operationId,
      ).catch(() => undefined);
    }
    return json(
      {
        error: limit.disabled
          ? "AI photo counting is disabled by the administrator."
          : "AI request limit reached. Try again shortly.",
      },
      { status: 429, headers: paidAiRateLimitHeaders(limit) },
    );
  }

  let preparedImage: Awaited<ReturnType<typeof prepareInventoryCountImage>>;
  try {
    preparedImage = await prepareInventoryCountImage(imageBytes);
  } catch {
    if (operationId) {
      await releaseAiOperation(
        authorization.identity.organizationId,
        operationId,
      ).catch(() => undefined);
    }
    return json(
      { error: "The uploaded file is not a readable, supported image." },
      { status: 422 },
    );
  }

  const finish = async (
    body: Record<string, unknown>,
    status: number,
    headers?: Record<string, string>,
  ) => {
    if (operationId) {
      try {
        await finishAiOperation({
          organizationId: authorization.identity.organizationId,
          operationId,
          body,
          status,
          headers,
        });
      } catch (error) {
        console.error("Unable to persist the count response for replay.", error);
        // If Replicate already accepted a prediction, still return its signed
        // job token to this caller. The processing claim remains reserved, so
        // a lost response cannot immediately start a second paid prediction.
      }
    }
    return json(body, { status, headers });
  };

  try {
    const localResult = await countDenseRepeatedInventoryItems({
      imageDataUrl: preparedImage.dataUrl,
      itemHint: parsed.data.itemHint,
      language: process.env.AI_OUTPUT_LANGUAGE,
    });
    if (localResult) {
      return finish(
        { ...localResult, model: denseComponentCountModelLabel },
        200,
      );
    }
  } catch (error) {
    // This path is an optional, conservative optimization. An unexpected
    // local analysis failure must not prevent the configured provider model
    // from handling the same valid image.
    console.error("Unable to run local dense-component counting.", error);
  }

  try {
    validateReplicateCountJobSigningSecret();
  } catch (error) {
    if (operationId) {
      await releaseAiOperation(
        authorization.identity.organizationId,
        operationId,
      ).catch(() => undefined);
    }
    console.error("Replicate count job signing is not configured.", error);
    return json(
      { error: "Photo counting has an invalid server configuration." },
      { status: 503 },
    );
  }

  let providerAttempted = false;
  try {
    providerAttempted = true;
    const outcome = await trackAiUsage({
      organizationId: authorization.identity.organizationId,
      estimate: aiUsageEstimate({
        action: "photo_count",
        modelId: countModel.id,
        model: countModel.model,
      }),
      actor: authorization.identity,
      resourceId: itemId,
      metadata: { modelId: countModel.id },
      run: () => countInventoryItems({
        imageDataUrl: preparedImage.dataUrl,
        imageWidth: preparedImage.width,
        imageHeight: preparedImage.height,
        itemHint: parsed.data.itemHint,
        modelId: countModel.id,
      }),
    });
    if (outcome.kind === "processing") {
      const jobToken = createReplicateCountJobToken({
        job: outcome.job,
        subjectHash: hashRequestIdentity(authorization.identity),
      });
      return finish(
        {
          status: "processing",
          jobToken,
          expiresAt: outcome.job.expiresAt,
          message: "The counting model is warming up.",
        },
        202,
        { "Retry-After": "3" },
      );
    }
    return finish({ ...outcome.result, model: outcome.model }, 200);
  } catch (error) {
    if (error instanceof AiMonthlyBudgetExceededError) {
      if (operationId) {
        await releaseAiOperation(
          authorization.identity.organizationId,
          operationId,
        ).catch(() => undefined);
      }
      return json(aiBudgetErrorBody(error), {
        status: 429,
        headers: paidAiRateLimitHeaders(limit),
      });
    }
    if (error instanceof InventoryCountLocalizationError) {
      if (error.ambiguousProviderCreate) {
        // Do not persist this as a finished response: the provider may already
        // be running a paid prediction whose ID was lost in transport. The
        // processing claim blocks the same attempt until its 15-minute lease
        // safely outlives Replicate's ten-minute maximum deadline.
        return json(
          { status: "starting", error: error.message },
          {
            status: 409,
            headers: {
              "Retry-After": String(error.retryAfterSeconds ?? 30),
            },
          },
        );
      }
      return finish({ error: error.message }, error.statusCode);
    }
    if (operationId && providerAttempted) {
      // A provider call may already exist even when an unexpected local step
      // (for example token serialization) failed. Keep this claim reserved and
      // make the client retry the same key instead of risking a second charge.
      console.error("Unable to finish an accepted Replicate count.", error);
      return json(
        {
          status: "starting",
          error:
            "The counting attempt is reserved, but its result could not be prepared. Wait before retrying the same photo.",
        },
        { status: 409, headers: { "Retry-After": "30" } },
      );
    }
    if (operationId) {
      try {
        await releaseAiOperation(
          authorization.identity.organizationId,
          operationId,
        );
      } catch (releaseError) {
        console.error("Unable to release the transient count claim.", releaseError);
      }
    }
    console.error("Unable to count inventory items with Replicate.", error);
    return json(
      { error: "Unable to count items in this image." },
      { status: 502 },
    );
  }
}
