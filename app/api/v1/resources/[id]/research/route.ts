import type { NewResource } from "@/db/schema";
import { researchInventoryDetails } from "@/lib/ai";
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
import {
  canAccessResource,
  requireResourcePermission,
} from "@/lib/api-auth";
import { hashIdempotentPayload, readIdempotencyKey } from "@/lib/idempotency";
import { buildInventoryResearchValues } from "@/lib/inventory-research-contract";
import {
  assertResourceIdentifiersAvailable,
  ResourceIdentifierConflictError,
} from "@/lib/resource-identifiers";
import {
  getResource,
  updateResourceWithCustomFieldValidation,
} from "@/lib/resources";
import { mediaToDataUrl } from "@/lib/storage";
import { researchInputSchema } from "@/lib/validators";

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
    // The research action currently has no client-configurable options.
  }
  const parsed = researchInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid AI research request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  let operationId: string | null = null;
  if (idempotency.key) {
    const claim = await claimAiOperation({
      organizationId: authorization.identity.organizationId,
      operation: "research",
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
        console.error("Unable to release the transient AI research claim.", error);
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

  const imageResults = await Promise.allSettled(
    resource.media
      .filter((item) => item.kind === "image")
      .slice(0, 3)
      .map(mediaToDataUrl),
  );
  const imageDataUrls = imageResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

  let limit;
  try {
    limit = await consumePaidAiRateLimit({
      organizationId: authorization.identity.organizationId,
      operation: "research",
      identity: authorization.identity,
    });
  } catch (error) {
    console.error("Unable to check the AI research rate limit.", error);
    return finishTransient(
      { error: "AI rate limiting is temporarily unavailable." },
      503,
    );
  }
  if (!limit.allowed) {
    return finishTransient(
      {
        error: limit.disabled
          ? "AI web research is disabled by the administrator."
          : "AI request limit reached. Try again shortly.",
      },
      429,
      paidAiRateLimitHeaders(limit),
    );
  }

  try {
    const researchContext = {
      name: resource.name,
      description: resource.description,
      type: resource.type,
      sku: resource.sku,
      tags: resource.tags,
      categories: resource.categories,
      serialNumber: resource.serialNumber,
      barcode: resource.barcode,
      valueCents: resource.valueCents,
      currency: resource.currency,
      notes: resource.notes,
      imageAltTexts: resource.media
        .filter((item) => item.kind === "image" && item.altText)
        .map((item) => item.altText),
    };
    const { result, model, sources } = await researchInventoryDetails({
      resource: researchContext,
      imageDataUrls,
    });
    const researchPatch = buildInventoryResearchValues(resource, result);
    const values: Partial<NewResource> = { ...researchPatch.values };
    const generatedFields = [...researchPatch.generatedFields];

    if (values.barcode) {
      try {
        await assertResourceIdentifiersAvailable(
          authorization.identity.organizationId,
          { barcode: values.barcode },
          resource.id,
        );
      } catch (error) {
        if (!(error instanceof ResourceIdentifierConflictError)) throw error;
        delete values.barcode;
        const fieldIndex = generatedFields.indexOf("barcode");
        if (fieldIndex >= 0) generatedFields.splice(fieldIndex, 1);
      }
    }

    values.aiMetadata = {
      analyzedAt: new Date().toISOString(),
      model,
      confidence: result.confidence,
      generatedFields,
      sources,
    };
    const updatedResource = await updateResourceWithCustomFieldValidation({
      organizationId: authorization.identity.organizationId,
      id: resource.id,
      values,
      validateCustomFields:
        values.type !== undefined || values.categories !== undefined,
      customFieldsProvided: false,
      actor: authorization.identity.subject,
      authorize: async (current, proposed) =>
        (await canAccessResource(authorization.identity, "ai.use", current)) &&
        (await canAccessResource(authorization.identity, "ai.use", proposed)),
    });
    if (!updatedResource) {
      throw new Error("Resource disappeared during AI web research.");
    }

    return finish(
      {
        resource: updatedResource,
        research: result,
        model,
        sources,
        updatedFields: generatedFields,
        translation: {
          status: generatedFields.some((field) =>
            ["name", "description", "type", "categories"].includes(field),
          )
            ? "queued"
            : "not_needed",
        },
      },
      200,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("RESOURCE_PERMISSION_DENIED")
    ) {
      return finish(
        {
          error:
            "This research would move the item outside the inventory rule that grants your access.",
        },
        403,
      );
    }
    return finish(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to research inventory details.",
      },
      502,
    );
  }
}
