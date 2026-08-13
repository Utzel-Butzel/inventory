import { asc, eq, sql } from "drizzle-orm";

import { aiIdempotencyOperations, media, resources } from "@/db/schema";
import {
  defaultCoverPrompt,
  defaultTransparentCoverPrompt,
  generateCoverImage,
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
import { hashIdempotentPayload, readIdempotencyKey } from "@/lib/idempotency";
import { resolveImageGenerationModel } from "@/lib/image-generation-models";
import { getResource } from "@/lib/resources";
import {
  deleteStoredMedia,
  readMediaBytes,
  storeMedia,
} from "@/lib/storage";
import { coverInputSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const authorization = await requireResourcePermission(request, "ai.use", id);
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // The default prompt and first image are valid without a body.
  }
  const parsed = coverInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid cover request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  let operationId: string | null = null;
  if (idempotency.key) {
    const claim = await claimAiOperation({
      operation: "cover",
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
    body: Record<string, unknown>,
    status: number,
    headers?: Record<string, string>,
  ) => {
    if (operationId) {
      await finishAiOperation({ operationId, body, status, headers });
    }
    return respondToFinishedAiOperation({
      body,
      status,
      headers,
      idempotencyKey: idempotency.key,
    });
  };
  const finishTransient = async (
    body: Record<string, unknown>,
    status: number,
    headers?: Record<string, string>,
  ) => {
    if (operationId) {
      try {
        await releaseAiOperation(operationId);
      } catch (error) {
        console.error("Unable to release the transient AI cover claim.", error);
      }
    }
    return respondToFinishedAiOperation({
      body,
      status,
      headers,
      idempotencyKey: idempotency.key,
    });
  };

  const imageModel = resolveImageGenerationModel(parsed.data.modelId);
  if (!imageModel) {
    return finish(
      {
        error: parsed.data.modelId
          ? "The selected image generation model is unsupported or unavailable."
          : "No image generation model is configured or available.",
      },
      422,
    );
  }

  const resource = await getResource(id);
  if (!resource) return finish({ error: "Not found" }, 404);
  const source = parsed.data.sourceMediaId
    ? resource.media.find((item) => item.id === parsed.data.sourceMediaId)
    : (resource.media.find(
        (item) => item.kind === "image" && item.source !== "ai",
      ) ?? resource.media.find((item) => item.kind === "image"));
  if (!source || source.kind !== "image") {
    return finish(
      { error: "Choose an image to use as the cover source." },
      400,
    );
  }

  let sourceBytes: Buffer;
  try {
    sourceBytes = await readMediaBytes(source);
  } catch (error) {
    return finish(
      {
        error:
          error instanceof Error ? error.message : "Unable to read cover source.",
      },
      502,
    );
  }

  let limit;
  try {
    limit = await consumePaidAiRateLimit({
      operation: "cover",
      identity: authorization.identity,
    });
  } catch (error) {
    console.error("Unable to check the AI cover rate limit.", error);
    return finishTransient(
      { error: "AI rate limiting is temporarily unavailable." },
      503,
    );
  }
  if (!limit.allowed) {
    return finishTransient(
      {
        error: limit.disabled
          ? "AI cover generation is disabled by the administrator."
          : "Image generation limit reached. Try again later.",
      },
      429,
      paidAiRateLimitHeaders(limit),
    );
  }

  try {
    const transparentBackground = parsed.data.transparentBackground ?? false;
    const generated = await generateCoverImage({
      source: sourceBytes,
      sourceMimeType: source.mimeType,
      prompt:
        parsed.data.prompt ||
        (transparentBackground
          ? defaultTransparentCoverPrompt(resource.name)
          : defaultCoverPrompt(resource.name)),
      imageModel,
      transparentBackground,
      transparencyMethod: parsed.data.transparencyMethod,
    });
    const fileExtension = generated.mimeType === "image/png" ? "png" : "jpg";
    const stored = await storeMedia({
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      originalName: `${resource.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-ai-cover.${fileExtension}`,
      resourceId: resource.id,
    });

    let responseBody: Record<string, unknown>;
    try {
      responseBody = await db.transaction(async (transaction) => {
        await transaction
          .update(media)
          .set({ position: sql`${media.position} + 1` })
          .where(eq(media.resourceId, resource.id));
        await transaction.insert(media).values({
          resourceId: resource.id,
          ...stored,
          position: 0,
          source: "ai",
          altText: generated.transparentBackground
            ? `AI-generated transparent-background cover of ${resource.name}`
            : `AI-generated studio cover of ${resource.name}`,
        });
        const [updated] = await transaction
          .update(resources)
          .set({
            aiMetadata: {
              ...(resource.aiMetadata ?? {}),
              analyzedAt: new Date().toISOString(),
              model: generated.model,
              generatedFields: Array.from(
                new Set([
                  ...(resource.aiMetadata?.generatedFields ?? []),
                  "cover",
                ]),
              ),
            },
            updatedAt: new Date(),
          })
          .where(eq(resources.id, resource.id))
          .returning();
        const mediaRows = await transaction
          .select()
          .from(media)
          .where(eq(media.resourceId, resource.id))
          .orderBy(asc(media.position));
        const body = {
          resource: {
            ...updated,
            media: mediaRows,
            cover: mediaRows.find((item) => item.kind === "image") ?? null,
          },
          generation: {
            id: generated.id,
            provider: generated.provider,
            model: generated.model,
            label: generated.label,
            transparentBackground: generated.transparentBackground,
            transparencyMethod: generated.transparencyMethod,
          },
        };
        if (operationId) {
          await transaction
            .update(aiIdempotencyOperations)
            .set(aiOperationResponseValues({ body, status: 200 }))
            .where(eq(aiIdempotencyOperations.id, operationId));
        }
        return body;
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
          error instanceof Error ? error.message : "Unable to generate cover image.",
      },
      502,
    );
  }
}
