import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import {
  TranslationLanguageError,
  TranslationRevisionConflictError,
  getResourceTranslationOverview,
  updateManualResourceTranslation,
} from "@/lib/content-translations";

type Context = {
  params: Promise<{ id: string; languageCode: string }>;
};

const operationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("set"),
      fieldKey: z.string().min(1).max(96),
      translatedText: z.string().max(100_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("accept_suggestion"),
      fieldKey: z.string().min(1).max(96),
    })
    .strict(),
  z
    .object({
      action: z.literal("use_ai"),
      fieldKey: z.string().min(1).max(96),
    })
    .strict(),
]);

const patchSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    operations: z.array(operationSchema).min(1).max(100),
  })
  .strict();

export async function PATCH(request: Request, context: Context) {
  const { id, languageCode } = await context.params;
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id,
  );
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid translation update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  if (parsed.data.operations.some((operation) => operation.action === "use_ai")) {
    const aiAuthorization = await requireResourcePermission(request, "ai.translate", id);
    if (aiAuthorization.response) return aiAuthorization.response;
  }
  try {
    const result = await updateManualResourceTranslation({
      organizationId: authorization.identity.organizationId,
      resourceId: id,
      languageCode,
      expectedRevision: parsed.data.expectedRevision,
      operations: parsed.data.operations,
      actor: authorization.identity.subject,
    });
    if (result.status === "not_found") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({
      result,
      translations: await getResourceTranslationOverview(
        authorization.identity.organizationId,
        id,
      ),
    });
  } catch (error) {
    if (error instanceof TranslationRevisionConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof TranslationLanguageError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update translation.",
      },
      { status: 500 },
    );
  }
}
