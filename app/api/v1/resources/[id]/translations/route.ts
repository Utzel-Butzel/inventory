import { z } from "zod";

import {
  TranslationLanguageError,
  enqueueResourceTranslations,
  getResourceTranslationOverview,
} from "@/lib/content-translations";
import { requirePermission, requireResourcePermission } from "@/lib/api-auth";

type Context = { params: Promise<{ id: string }> };

const translationRequestSchema = z
  .object({
    languageCodes: z.array(z.string().trim().min(2).max(35)).max(20).optional(),
    force: z.boolean().optional().default(false),
  })
  .strict();

export const runtime = "nodejs";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  const overview = await getResourceTranslationOverview((await context.params).id);
  if (!overview) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ translations: overview });
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const authorization = await requireResourcePermission(request, "ai.use", id);
  if (authorization.response) return authorization.response;
  let payload: unknown = {};
  try {
    const text = await request.text();
    payload = text ? JSON.parse(text) : {};
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = translationRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid translation request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const result = await enqueueResourceTranslations({
      resourceId: id,
      requestedBy: authorization.identity.subject,
      languageCodes: parsed.data.languageCodes,
      force: parsed.data.force,
    });
    if (result.status === "not_found") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const overview = await getResourceTranslationOverview(id);
    return Response.json(
      { result, translations: overview },
      { status: result.status === "queued" ? 202 : 200 },
    );
  } catch (error) {
    if (error instanceof TranslationLanguageError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to queue AI translation.",
      },
      { status: 500 },
    );
  }
}
