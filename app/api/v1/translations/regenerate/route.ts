import { z } from "zod";

import { requireSessionPermission } from "@/lib/api-auth";
import {
  TranslationLanguageError,
  enqueueTranslationBackfill,
} from "@/lib/content-translations";

const batchSchema = z
  .object({
    languageCodes: z.array(z.string().trim().min(2).max(35)).max(20).optional(),
    force: z.boolean().optional().default(false),
  })
  .strict();

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(
    request,
    "settings.languages.manage",
  );
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
  const parsed = batchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid translation batch.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const result = await enqueueTranslationBackfill({
      organizationId: authorization.identity.organizationId,
      requestedBy: authorization.identity.subject,
      languageCodes: parsed.data.languageCodes,
      force: parsed.data.force,
    });
    return Response.json({ result }, { status: result.jobs ? 202 : 200 });
  } catch (error) {
    if (error instanceof TranslationLanguageError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to queue inventory translations.",
      },
      { status: 500 },
    );
  }
}
