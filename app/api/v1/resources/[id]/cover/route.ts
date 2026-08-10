import { asc, eq, sql } from "drizzle-orm";

import { aiIdempotencyOperations, media, resources } from "@/db/schema";
import { defaultCoverPrompt, generateCoverImage } from "@/lib/ai";
import {
  aiOperationResponseValues,
  claimAiOperation,
  finishAiOperation,
  respondToAiOperationClaim,
  respondToFinishedAiOperation,
} from "@/lib/ai-idempotency";
import { requireIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { hashIdempotentPayload, readIdempotencyKey } from "@/lib/idempotency";
import { checkRateLimit } from "@/lib/rate-limit";
import { getResource } from "@/lib/resources";
import {
  deleteStoredMedia,
  readMediaBytes,
  storeMedia,
} from "@/lib/storage";
import { coverInputSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "ai");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;

  const { id } = await context.params;
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

  const resource = await getResource(id);
  if (!resource) return finish({ error: "Not found" }, 404);
  const source = parsed.data.sourceMediaId
    ? resource.media.find((item) => item.id === parsed.data.sourceMediaId)
    : resource.media.find((item) => item.kind === "image");
  if (!source || source.kind !== "image") {
    return finish(
      { error: "Choose an image to use as the cover source." },
      400,
    );
  }

  const limit = checkRateLimit(`cover:${authorization.identity.subject}`, {
    limit: Number(process.env.AI_IMAGE_RATE_LIMIT_PER_HOUR ?? "12"),
    windowMs: 60 * 60 * 1_000,
  });
  if (!limit.allowed) {
    return finish(
      { error: "Image generation limit reached. Try again later." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds ?? 3600) },
    );
  }

  try {
    const sourceBytes = await readMediaBytes(source);
    const generated = await generateCoverImage({
      source: sourceBytes,
      sourceMimeType: source.mimeType,
      prompt: parsed.data.prompt || defaultCoverPrompt(resource.name),
    });
    const stored = await storeMedia({
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      originalName: `${resource.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-ai-cover.jpg`,
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
          altText: `AI-generated studio cover of ${resource.name}`,
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
          generation: { provider: generated.provider, model: generated.model },
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
