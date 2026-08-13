import { createHash } from "node:crypto";

import {
  describeInventoryRecognitionImage,
  matchInventoryRecognitionCandidates,
  prepareInventoryCountImage,
  prepareInventoryRecognitionReferenceImage,
} from "@/lib/ai";
import {
  claimAiOperation,
  finishAiOperation,
  releaseAiOperation,
  respondToAiOperationClaim,
  respondToFinishedAiOperation,
} from "@/lib/ai-idempotency";
import {
  consumePaidAiRateLimit,
  paidAiRateLimitHeaders,
} from "@/lib/ai-rate-limit";
import { listRulesForRole, ruleGrantsResourcePermission } from "@/lib/access-control";
import { hashRequestIdentity, requireIdentity } from "@/lib/api-auth";
import { hashIdempotentPayload, readIdempotencyKey } from "@/lib/idempotency";
import {
  inventoryRecognitionIsConfident,
  shortlistInventoryRecognitionCandidates,
  type InventoryRecognitionSearchCandidate,
} from "@/lib/inventory-recognition-contract";
import {
  countResourcesForRecognition,
  listResourcesForRecognition,
} from "@/lib/resources";
import { maxUploadBytes, readMediaBytes } from "@/lib/storage";

const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
]);
const noStoreHeaders = { "Cache-Control": "no-store" };
const recognitionImageSizeLimit = () =>
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

const configuredCatalogLimit = () => {
  const value = Number(process.env.AI_RECOGNITION_MAX_CATALOG_ITEMS ?? "2000");
  return Number.isSafeInteger(value) ? Math.min(5_000, Math.max(1, value)) : 2_000;
};

const boundedText = (value: string, maximumLength: number) =>
  value.length <= maximumLength ? value : `${value.slice(0, maximumLength)}…`;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const authorization = await requireIdentity(request, "ai");
  if (authorization.response) return authorization.response;
  if (
    !authorization.identity.scopes.includes("read") ||
    !authorization.identity.permissions.includes("inventory.read")
  ) {
    return json(
      { error: "Object recognition also requires inventory read access." },
      { status: 403 },
    );
  }

  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return json(
      {
        error:
          "Idempotency-Key is required for paid photo recognition and must be a UUID.",
      },
      { status: 400 },
    );
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return json({ error: "Expected a multipart image upload." }, { status: 415 });
  }

  const imageSizeLimit = recognitionImageSizeLimit();
  const contentLengthValue = request.headers.get("content-length");
  if (contentLengthValue !== null) {
    const contentLength = Number(contentLengthValue);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      return json({ error: "Invalid Content-Length header." }, { status: 400 });
    }
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
    return json(
      {
        error:
          error instanceof MultipartBodyTooLargeError
            ? "The image exceeds the upload size limit."
            : "Invalid multipart upload.",
      },
      { status: error instanceof MultipartBodyTooLargeError ? 413 : 400 },
    );
  }

  const imageEntries = form.getAll("image");
  if (imageEntries.length !== 1 || !(imageEntries[0] instanceof File)) {
    return json(
      { error: "Upload exactly one image in the image field." },
      { status: 422 },
    );
  }
  const image = imageEntries[0];
  if (!image.size) return json({ error: "The image is empty." }, { status: 422 });
  if (image.size > imageSizeLimit) {
    return json(
      { error: "The image exceeds the upload size limit." },
      { status: 413 },
    );
  }
  const mimeType = image.type.split(";", 1)[0].trim().toLowerCase();
  if (!supportedImageTypes.has(mimeType)) {
    return json(
      { error: `Unsupported image type (${mimeType || "unknown"}).` },
      { status: 415 },
    );
  }

  const imageBytes = Buffer.from(await image.arrayBuffer());
  let operationId: string | null = null;
  if (idempotency.key) {
    let claim;
    try {
      claim = await claimAiOperation({
        operation: "recognize",
        idempotencyKey: idempotency.key,
        resourceId: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: hashRequestIdentity(authorization.identity),
          imageSha256: createHash("sha256").update(imageBytes).digest("hex"),
          mimeType,
        }),
      });
    } catch (error) {
      console.error("Unable to claim an idempotent recognition request.", error);
      return json(
        { error: "Recognition retry protection is temporarily unavailable." },
        { status: 503 },
      );
    }
    if (claim.kind !== "claimed") {
      const response = respondToAiOperationClaim(claim, idempotency.key);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    operationId = claim.operationId;
  }

  const finish = async (
    body: Record<string, unknown>,
    status: number,
    headers?: Record<string, string>,
  ) => {
    const responseHeaders = { ...noStoreHeaders, ...headers };
    if (operationId) {
      await finishAiOperation({
        operationId,
        body,
        status,
        headers: responseHeaders,
      });
    }
    return respondToFinishedAiOperation({
      body,
      status,
      headers: responseHeaders,
      idempotencyKey: idempotency.key,
    });
  };
  const releaseAndRespond = async (
    body: Record<string, unknown>,
    status: number,
    headers?: Record<string, string>,
  ) => {
    if (operationId) {
      await releaseAiOperation(operationId).catch((error) => {
        console.error("Unable to release the recognition claim.", error);
      });
    }
    return json(body, { status, headers });
  };

  let preparedImage: Awaited<ReturnType<typeof prepareInventoryCountImage>>;
  try {
    preparedImage = await prepareInventoryCountImage(imageBytes);
  } catch {
    return releaseAndRespond(
      { error: "The uploaded file is not a readable, supported image." },
      422,
    );
  }

  let inventoryTotal;
  try {
    inventoryTotal = await countResourcesForRecognition();
  } catch (error) {
    console.error("Unable to inspect the recognition catalog.", error);
    return releaseAndRespond(
      { error: "The inventory catalog is temporarily unavailable." },
      503,
    );
  }
  if (!inventoryTotal) {
    return finish(
      {
        detected: null,
        matches: [],
        isConfident: false,
        model: null,
        catalog: { considered: 0, truncated: false },
      },
      200,
    );
  }

  let limit;
  try {
    limit = await consumePaidAiRateLimit({
      operation: "recognize",
      identity: authorization.identity,
    });
  } catch (error) {
    console.error("Unable to check the recognition rate limit.", error);
    return releaseAndRespond(
      { error: "AI rate limiting is temporarily unavailable." },
      503,
    );
  }
  if (!limit.allowed) {
    return releaseAndRespond(
      {
        error: limit.disabled
          ? "AI object recognition is disabled by the administrator."
          : "AI request limit reached. Try again shortly.",
      },
      429,
      paidAiRateLimitHeaders(limit),
    );
  }

  let described;
  try {
    described = await describeInventoryRecognitionImage(
      preparedImage.dataUrl,
    );
  } catch (error) {
    console.error("Unable to describe the inventory object.", error);
    return finish(
      {
        error: "The AI provider could not complete object recognition.",
        terminal: true,
      },
      502,
    );
  }

  let catalog: Awaited<ReturnType<typeof listResourcesForRecognition>>;
  let visibleResources: Awaited<
    ReturnType<typeof listResourcesForRecognition>
  >["resources"];
  try {
    catalog = await listResourcesForRecognition(
      [
        described.observation.label,
        described.observation.category,
        described.observation.brand,
        described.observation.model,
        ...described.observation.visibleText,
        ...described.observation.searchTerms,
      ].filter((term): term is string => Boolean(term)),
      configuredCatalogLimit(),
    );
    if (authorization.identity.permissions.includes("ai.use")) {
      visibleResources = catalog.resources;
    } else if (authorization.identity.role) {
      const rules = await listRulesForRole(authorization.identity.role);
      visibleResources = catalog.resources.filter((resource) =>
        ruleGrantsResourcePermission({
          roleKey: authorization.identity.role!,
          permission: "ai.use",
          resource,
          rules,
        }),
      );
    } else {
      visibleResources = [];
    }
  } catch (error) {
    console.error("Unable to load the recognition catalog.", error);
    return finish(
      {
        error: "The inventory catalog is temporarily unavailable.",
        terminal: true,
      },
      503,
    );
  }

  if (!visibleResources.length) {
    return finish(
      {
        detected: described.observation,
        matches: [],
        isConfident: false,
        model: described.model,
        catalog: { considered: 0, truncated: catalog.truncated },
      },
      200,
    );
  }

  try {
    const searchCandidates: InventoryRecognitionSearchCandidate[] =
      visibleResources.map((resource) => ({
        id: resource.id,
        name: resource.name,
        description: resource.description,
        type: resource.type,
        sku: resource.sku,
        barcode: resource.barcode,
        serialNumber: resource.serialNumber,
        tags: resource.tags,
        categories: resource.categories,
        customFields: resource.customFields,
        imageAltTexts: resource.media
          .filter((item) => item.kind === "image" && item.altText.trim())
          .map((item) => item.altText),
        updatedAt: resource.updatedAt,
      }));
    const scoredShortlist = shortlistInventoryRecognitionCandidates(
      described.observation,
      searchCandidates,
      14,
    );
    const scoredIds = new Set(
      scoredShortlist.map((entry) => entry.candidate.id),
    );
    const visualFallback = searchCandidates
      .filter(
        (candidate) =>
          !scoredIds.has(candidate.id) &&
          catalog.visualFallbackResourceIds.has(candidate.id),
      )
      .slice(0, Math.max(0, 20 - scoredShortlist.length))
      .map((candidate) => ({ candidate, score: 0 }));
    const shortlist = [...scoredShortlist, ...visualFallback];
    const resourcesById = new Map(
      visibleResources.map((resource) => [resource.id, resource]),
    );
    const visualFallbackIds = new Set(
      visualFallback.map((entry) => entry.candidate.id),
    );
    const hasReferenceImage = (entry: (typeof shortlist)[number]) =>
      resourcesById
        .get(entry.candidate.id)
        ?.media.some((item) => item.kind === "image") ?? false;
    const referenceEntries = [
      ...shortlist
        .filter(
          (entry) =>
            visualFallbackIds.has(entry.candidate.id) &&
            hasReferenceImage(entry),
        )
        .slice(0, 3),
      ...shortlist
        .filter(
          (entry) =>
            !visualFallbackIds.has(entry.candidate.id) &&
            hasReferenceImage(entry),
        )
        .slice(0, 5),
    ];
    const references = (
      await Promise.all(
        referenceEntries
          .map(async (entry) => {
            const resource = resourcesById.get(entry.candidate.id)!;
            const reference =
              resource.media.find(
                (item) => item.kind === "image" && item.source === "upload",
              ) ?? resource.media.find((item) => item.kind === "image")!;
            try {
              const bytes = await readMediaBytes(reference);
              const preparedReference =
                await prepareInventoryRecognitionReferenceImage(bytes);
              return {
                resourceId: resource.id,
                imageDataUrl: preparedReference.dataUrl,
              };
            } catch {
              // A missing legacy image weakens this candidate but must not abort the search.
              return null;
            }
          }),
      )
    ).flatMap((reference) => (reference ? [reference] : []));
    const reranked = await matchInventoryRecognitionCandidates({
      imageDataUrl: preparedImage.dataUrl,
      observation: described.observation,
      candidates: shortlist.map(({ candidate }) => ({
        resourceId: candidate.id,
        name: candidate.name,
        description: boundedText(candidate.description, 1_000),
        type: candidate.type,
        sku: candidate.sku,
        barcode: candidate.barcode,
        serialNumber: candidate.serialNumber,
        tags: candidate.tags.slice(0, 20),
        categories: candidate.categories.map((category) => category.name),
        imageAltTexts: candidate.imageAltTexts.slice(0, 5),
      })),
      references,
    });
    const matches = reranked.matches.flatMap((match) => {
      const resource = resourcesById.get(match.resourceId);
      return resource ? [{ ...match, resource }] : [];
    });
    const referencedResourceIds = new Set(
      references.map((reference) => reference.resourceId),
    );
    return finish(
      {
        detected: described.observation,
        matches,
        isConfident: inventoryRecognitionIsConfident(matches, {
          observationConfidence: described.observation.confidence,
          leadingMatchHasReferenceImage: matches[0]
            ? referencedResourceIds.has(matches[0].resourceId)
            : false,
        }),
        model: reranked.model,
        catalog: {
          considered: visibleResources.length,
          truncated: catalog.truncated,
        },
      },
      200,
    );
  } catch (error) {
    console.error("Unable to recognize the inventory object.", error);
    return finish(
      {
        error: "The AI provider could not complete inventory matching.",
        terminal: true,
      },
      502,
    );
  }
}
