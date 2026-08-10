import { asc, eq, inArray } from "drizzle-orm";

import {
  aiIdempotencyOperations,
  media,
  resources,
  type NewResource,
} from "@/db/schema";
import { analyzeInventoryImages } from "@/lib/ai";
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
import { mediaToDataUrl } from "@/lib/storage";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "ai");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;

  const { id } = await context.params;
  let overwrite = true;
  try {
    const body = (await request.json()) as { overwrite?: unknown };
    overwrite = body.overwrite !== false;
  } catch {
    // An empty body uses the default behavior.
  }

  let operationId: string | null = null;
  if (idempotency.key) {
    const claim = await claimAiOperation({
      operation: "analyze",
      idempotencyKey: idempotency.key,
      resourceId: id,
      requestHash: hashIdempotentPayload({
        actor: authorization.identity.subject,
        resourceId: id,
        input: { overwrite },
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
  const imageMedia = resource.media
    .filter((item) => item.kind === "image")
    .slice(0, 3);
  if (!imageMedia.length) {
    return finish(
      { error: "Upload at least one image before running AI analysis." },
      400,
    );
  }

  const limit = checkRateLimit(`analyze:${authorization.identity.subject}`, {
    limit: Number(process.env.AI_RATE_LIMIT_PER_MINUTE ?? "10"),
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return finish(
      { error: "AI request limit reached. Try again shortly." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds ?? 60) },
    );
  }

  try {
    const dataUrls = await Promise.all(imageMedia.map(mediaToDataUrl));
    const { result, model } = await analyzeInventoryImages(dataUrls);
    const generatedFields: string[] = [];
    const values: Partial<NewResource> = {
      aiMetadata: {
        analyzedAt: new Date().toISOString(),
        model,
        confidence: result.confidence,
        generatedFields,
      },
    };
    if (overwrite || !resource.name || resource.name === "Untitled item") {
      values.name = result.title;
      generatedFields.push("name");
    }
    if (overwrite || !resource.description) {
      values.description = result.description;
      generatedFields.push("description");
    }
    if (overwrite || !resource.tags.length) {
      values.tags = result.tags;
      generatedFields.push("tags");
    }
    if (overwrite || resource.type === "object") {
      values.type = result.type;
      generatedFields.push("type");
    }
    const responseBody = await db.transaction(async (transaction) => {
      await transaction
        .update(media)
        .set({ altText: result.altText })
        .where(inArray(media.id, imageMedia.map((item) => item.id)));
      const [updated] = await transaction
        .update(resources)
        .set({ ...values, updatedAt: new Date() })
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
        analysis: result,
        model,
      };
      if (operationId) {
        await transaction
          .update(aiIdempotencyOperations)
          .set(aiOperationResponseValues({ body, status: 200 }))
          .where(eq(aiIdempotencyOperations.id, operationId));
      }
      return body;
    });
    return respondToFinishedAiOperation({
      body: responseBody,
      status: 200,
      idempotencyKey: idempotency.key,
    });
  } catch (error) {
    return finish(
      {
        error:
          error instanceof Error ? error.message : "Unable to analyze item images.",
      },
      502,
    );
  }
}
