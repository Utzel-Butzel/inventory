import { z } from "zod";

import { requirePermission, requireSessionPermission } from "@/lib/api-auth";
import {
  contentLanguageHttpError,
  createTranslationLanguage,
  listTranslationLanguages,
} from "@/lib/content-languages";

const languageCreateSchema = z
  .object({
    code: z.string().trim().min(2).max(35),
    label: z.string().trim().min(1).max(120),
    isDefault: z.boolean().optional().default(false),
    autoTranslate: z.boolean().optional().default(true),
    instructions: z.string().trim().max(5_000).optional().default(""),
    position: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  const includeArchived =
    authorization.identity.permissions.includes("settings.languages.manage") &&
    new URL(request.url).searchParams.get("includeArchived") === "true";
  return Response.json({
    languages: await listTranslationLanguages(includeArchived),
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(request, "settings.languages.manage");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = languageCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid content language.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const language = await createTranslationLanguage(
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ language }, { status: 201 });
  } catch (error) {
    const failure = contentLanguageHttpError(error);
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
