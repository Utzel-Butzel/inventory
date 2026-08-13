import { z } from "zod";

import { requireSessionPermission } from "@/lib/api-auth";
import {
  contentLanguageHttpError,
  updateTranslationLanguage,
} from "@/lib/content-languages";

type Context = { params: Promise<{ code: string }> };

const languagePatchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    isDefault: z.boolean().optional(),
    autoTranslate: z.boolean().optional(),
    instructions: z.string().trim().max(5_000).optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one language change.",
  });

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "settings.languages.manage");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = languagePatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid language change.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const language = await updateTranslationLanguage(
      (await context.params).code,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ language });
  } catch (error) {
    const failure = contentLanguageHttpError(error);
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "settings.languages.manage");
  if (authorization.response) return authorization.response;
  try {
    const language = await updateTranslationLanguage(
      (await context.params).code,
      { archived: true },
      authorization.identity.subject,
    );
    return Response.json({ language });
  } catch (error) {
    const failure = contentLanguageHttpError(error);
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
