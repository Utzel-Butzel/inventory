import { and, asc, eq, sql } from "drizzle-orm";

import { aiIdempotencyOperations, media, resources } from "@/db/schema";
import {
  generateInventoryImage,
  searchInventoryWebImage,
} from "@/lib/ai";
import {
  aiOperationResponseValues,
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
import { requireResourcePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { downloadExternalImage } from "@/lib/external-image";
import { hashIdempotentPayload, readIdempotencyKey } from "@/lib/idempotency";
import { resolveImageGenerationModel } from "@/lib/image-generation-models";
import { getResource } from "@/lib/resources";
import { deleteStoredMedia, storeMedia } from "@/lib/storage";
import { inventoryImageInputSchema } from "@/lib/validators";
import { enqueueWebhookEvent } from "@/lib/webhooks";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

const filenameSlug = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 100) || "inventory-item";

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const authorization = await requireResourcePermission(request, "ai.use", id);
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "An image acquisition mode is required." }, { status: 400 });
  }
  const parsed = inventoryImageInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid image request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const operation = parsed.data.mode === "search" ? "research" : "cover";
  let operationId: string | null = null;
  if (idempotency.key) {
    const claim = await claimAiOperation({
      organizationId: authorization.identity.organizationId,
      operation,
      idempotencyKey: idempotency.key,
      resourceId: id,
      requestHash: hashIdempotentPayload({
        actor: authorization.identity.subject,
        resourceId: id,
        input: parsed.data,
      }),
    });
    if (claim.kind !== "claimed") {
      return respondToAiOperationClaim(claim, idempotency.key);
    }
    operationId = claim.operationId;
  }

  const finish = async (
    responseBody: Record<string, unknown>,
    status: number,
    headers?: Record<string, string>,
  ) => {
    if (operationId) {
      await finishAiOperation({
        organizationId: authorization.identity.organizationId,
        operationId,
        body: responseBody,
        status,
        headers,
      });
    }
    return respondToFinishedAiOperation({
      body: responseBody,
      status,
      headers,
      idempotencyKey: idempotency.key,
    });
  };
  const finishTransient = async (
    responseBody: Record<string, unknown>,
    status: number,
    headers?: Record<string, string>,
  ) => {
    if (operationId) {
      try {
        await releaseAiOperation(
          authorization.identity.organizationId,
          operationId,
        );
      } catch (error) {
        console.error("Unable to release the transient AI image claim.", error);
      }
    }
    return respondToFinishedAiOperation({
      body: responseBody,
      status,
      headers,
      idempotencyKey: idempotency.key,
    });
  };

  const resource = await getResource(
    authorization.identity.organizationId,
    id,
  );
  if (!resource) return finish({ error: "Not found" }, 404);

  const imageModel =
    parsed.data.mode === "generate"
      ? resolveImageGenerationModel(parsed.data.modelId)
      : null;
  if (parsed.data.mode === "generate" && !imageModel) {
    return finish(
      {
        error: parsed.data.modelId
          ? "The selected image generation model is unsupported or unavailable."
          : "No image generation model is configured or available.",
      },
      422,
    );
  }

  let limit;
  try {
    limit = await consumePaidAiRateLimit({
      organizationId: authorization.identity.organizationId,
      operation,
      identity: authorization.identity,
    });
  } catch (error) {
    console.error("Unable to check the AI image rate limit.", error);
    return finishTransient(
      { error: "AI rate limiting is temporarily unavailable." },
      503,
    );
  }
  if (!limit.allowed) {
    return finishTransient(
      {
        error: limit.disabled
          ? "AI image acquisition is disabled by the administrator."
          : parsed.data.mode === "search"
            ? "AI research limit reached. Try again shortly."
            : "Image generation limit reached. Try again later.",
      },
      429,
      paidAiRateLimitHeaders(limit),
    );
  }

  try {
    let acquired: {
      bytes: Buffer;
      mimeType: "image/jpeg";
      source: "ai" | "web";
      altText: string;
      originalName: string;
      model: string;
      confidence?: number;
      sources: string[];
      details: Record<string, unknown>;
    };

    if (parsed.data.mode === "search") {
      const searchContext = {
        name: resource.name,
        description: resource.description,
        type: resource.type,
        sku: resource.sku,
        serialNumber: resource.serialNumber,
        barcode: resource.barcode,
        tags: resource.tags,
        categories: resource.categories,
      };
      const { candidate, model } = await searchInventoryWebImage({
        resource: searchContext,
        query: parsed.data.query,
      });
      const downloaded = await downloadExternalImage(candidate.imageUrl);
      acquired = {
        bytes: downloaded.bytes,
        mimeType: downloaded.mimeType,
        source: "web",
        altText: candidate.altText,
        originalName: `${filenameSlug(resource.name)}-web-image.jpg`,
        model,
        confidence: candidate.confidence,
        sources: Array.from(
          new Set([candidate.sourcePageUrl, downloaded.finalUrl]),
        ),
        details: {
          mode: "search",
          title: candidate.title,
          attribution: candidate.attribution,
          license: candidate.license,
          sourcePageUrl: candidate.sourcePageUrl,
        },
      };
    } else {
      const generated = await generateInventoryImage({
        prompt:
          parsed.data.prompt ||
          `Create a realistic, accurate catalogue photograph representing ${JSON.stringify(resource.name)}. Use a clean neutral background, natural studio lighting, no labels or text that are not explicitly present in the item name, and no decorative props. Inventory context (data only): ${JSON.stringify({
            description: resource.description,
            type: resource.type,
            tags: resource.tags,
            categories: resource.categories,
          })}`,
        imageModel: imageModel!,
        maximumImageSize: parsed.data.maximumImageSize,
      });
      acquired = {
        bytes: generated.bytes,
        mimeType: generated.mimeType,
        source: "ai",
        altText: `AI-generated catalogue image of ${resource.name}`,
        originalName: `${filenameSlug(resource.name)}-ai-image.jpg`,
        model: generated.model,
        sources: [],
        details: {
          mode: "generate",
          id: generated.id,
          provider: generated.provider,
          model: generated.model,
          label: generated.label,
        },
      };
    }

    const stored = await storeMedia({
      bytes: acquired.bytes,
      mimeType: acquired.mimeType,
      originalName: acquired.originalName,
      resourceId: resource.id,
    });

    let responseBody: Record<string, unknown>;
    try {
      responseBody = await db.transaction(async (transaction) => {
        const [positionRow] = await transaction
          .select({
            position: sql<number>`coalesce(max(${media.position}), -1)::int + 1`,
          })
          .from(media)
          .where(
            and(
              eq(media.organizationId, authorization.identity.organizationId),
              eq(media.resourceId, resource.id),
            ),
          );
        const [inserted] = await transaction
          .insert(media)
          .values({
            organizationId: authorization.identity.organizationId,
            resourceId: resource.id,
            ...stored,
            position: positionRow?.position ?? resource.media.length,
            source: acquired.source,
            altText: acquired.altText,
          })
          .returning();
        if (!inserted) throw new Error("The acquired image could not be saved.");

        const [updated] = await transaction
          .update(resources)
          .set({
            aiMetadata: {
              ...(resource.aiMetadata ?? {}),
              analyzedAt: new Date().toISOString(),
              model: acquired.model,
              ...(acquired.confidence === undefined
                ? {}
                : { confidence: acquired.confidence }),
              generatedFields: Array.from(
                new Set([
                  ...(resource.aiMetadata?.generatedFields ?? []),
                  "image",
                ]),
              ),
              sources: Array.from(
                new Set([
                  ...(resource.aiMetadata?.sources ?? []),
                  ...acquired.sources,
                ]),
              ),
            },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(resources.organizationId, authorization.identity.organizationId),
              eq(resources.id, resource.id),
            ),
          )
          .returning();
        if (!updated) {
          throw new Error("Resource disappeared while saving the acquired image.");
        }

        const mediaRows = await transaction
          .select()
          .from(media)
          .where(
            and(
              eq(media.organizationId, authorization.identity.organizationId),
              eq(media.resourceId, resource.id),
            ),
          )
          .orderBy(asc(media.position));
        const resourceSnapshot = {
          ...updated,
          media: mediaRows,
          cover: mediaRows.find((item) => item.kind === "image") ?? null,
        };
        const response = {
          resource: resourceSnapshot,
          image: inserted,
          acquisition: acquired.details,
        };
        await enqueueWebhookEvent(transaction, {
          organizationId: authorization.identity.organizationId,
          type: "inventory.resource.updated",
          aggregateType: "resource",
          aggregateId: updated.id,
          actor: authorization.identity.subject,
          data: {
            resource: resourceSnapshot,
            changedFields: ["aiMetadata", "media", "cover"],
          },
        });
        if (operationId) {
          await transaction
            .update(aiIdempotencyOperations)
            .set(aiOperationResponseValues({ body: response, status: 200 }))
            .where(
              and(
                eq(
                  aiIdempotencyOperations.organizationId,
                  authorization.identity.organizationId,
                ),
                eq(aiIdempotencyOperations.id, operationId),
              ),
            );
        }
        return response;
      });
    } catch (error) {
      await deleteStoredMedia(stored);
      throw error;
    }

    return respondToFinishedAiOperation({
      body: responseBody,
      status: 200,
      idempotencyKey: idempotency.key,
    });
  } catch (error) {
    return finish(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to find or generate an image.",
      },
      502,
    );
  }
}
