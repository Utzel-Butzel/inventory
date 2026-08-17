import { and, asc, eq, inArray } from "drizzle-orm";

import {
  aiIdempotencyOperations,
  media,
  type NewResource,
} from "@/db/schema";
import { analyzeInventoryImages } from "@/lib/ai";
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
import {
  canAccessResource,
  requireResourcePermission,
} from "@/lib/api-auth";
import { db } from "@/lib/db";
import { hashIdempotentPayload, readIdempotencyKey } from "@/lib/idempotency";
import {
  getResource,
  updateResourceWithCustomFieldValidation,
} from "@/lib/resources";
import { mediaToDataUrl } from "@/lib/storage";
import { analyzeInputSchema } from "@/lib/validators";
import { enqueueWebhookEvent } from "@/lib/webhooks";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 120;

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
    // An empty body uses the default behavior.
  }
  const parsed = analyzeInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid analysis request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const { overwrite, prompt } = parsed.data;

  let operationId: string | null = null;
  if (idempotency.key) {
    const claim = await claimAiOperation({
      organizationId: authorization.identity.organizationId,
      operation: "analyze",
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
      await finishAiOperation({
        organizationId: authorization.identity.organizationId,
        operationId,
        body,
        status,
        headers,
      });
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
        await releaseAiOperation(
          authorization.identity.organizationId,
          operationId,
        );
      } catch (error) {
        console.error("Unable to release the transient AI analysis claim.", error);
      }
    }
    return respondToFinishedAiOperation({
      body,
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
  const imageMedia = resource.media
    .filter((item) => item.kind === "image")
    .slice(0, 3);
  if (!imageMedia.length) {
    return finish(
      { error: "Upload at least one image before running AI analysis." },
      400,
    );
  }

  let dataUrls: string[];
  try {
    dataUrls = await Promise.all(imageMedia.map(mediaToDataUrl));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("RESOURCE_PERMISSION_DENIED")
    ) {
      return finish(
        {
          error:
            "This analysis cannot update every non-overridden item in the variant family under your current access rules.",
        },
        403,
      );
    }
    return finish(
      {
        error:
          error instanceof Error ? error.message : "Unable to read item images.",
      },
      502,
    );
  }

  let limit;
  try {
    limit = await consumePaidAiRateLimit({
      organizationId: authorization.identity.organizationId,
      operation: "analyze",
      identity: authorization.identity,
    });
  } catch (error) {
    console.error("Unable to check the AI analysis rate limit.", error);
    return finishTransient(
      { error: "AI rate limiting is temporarily unavailable." },
      503,
    );
  }
  if (!limit.allowed) {
    return finishTransient(
      {
        error: limit.disabled
          ? "AI analysis is disabled by the administrator."
          : "AI request limit reached. Try again shortly.",
      },
      429,
      paidAiRateLimitHeaders(limit),
    );
  }

  try {
    const { result, model } = await analyzeInventoryImages(dataUrls, prompt);
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
    if (
      !(await canAccessResource(authorization.identity, "ai.use", {
        ...resource,
        ...values,
      }))
    ) {
      return finish(
        {
          error:
            "This analysis would move the item outside the inventory rule that grants your access.",
        },
        403,
      );
    }
    const updatedResource = await updateResourceWithCustomFieldValidation({
      organizationId: authorization.identity.organizationId,
      id: resource.id,
      values,
      validateCustomFields: values.type !== undefined,
      customFieldsProvided: false,
      actor: authorization.identity.subject,
      authorize: async (current, proposed) =>
        (await canAccessResource(
          authorization.identity,
          "ai.use",
          current,
        )) &&
        (await canAccessResource(
          authorization.identity,
          "ai.use",
          proposed,
        )),
    });
    if (!updatedResource) {
      throw new Error("Resource disappeared during AI analysis.");
    }

    const responseBody = await db.transaction(async (transaction) => {
      await transaction
        .update(media)
        .set({ altText: result.altText })
        .where(
          and(
            eq(media.organizationId, authorization.identity.organizationId),
            inArray(media.id, imageMedia.map((item) => item.id)),
          ),
        );
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
        ...updatedResource,
        media: mediaRows,
        cover: mediaRows.find((item) => item.kind === "image") ?? null,
      };
      const body = {
        resource: resourceSnapshot,
        analysis: result,
        model,
      };
      await enqueueWebhookEvent(transaction, {
        organizationId: authorization.identity.organizationId,
        type: "inventory.resource.updated",
        aggregateType: "resource",
        aggregateId: updatedResource.id,
        actor: authorization.identity.subject,
        data: {
          resource: resourceSnapshot,
          changedFields: ["media"],
        },
      });
      if (operationId) {
        await transaction
          .update(aiIdempotencyOperations)
          .set(aiOperationResponseValues({ body, status: 200 }))
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
      return body;
    });
    return respondToFinishedAiOperation({
      body: { ...responseBody, translation: { status: "queued" } },
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
