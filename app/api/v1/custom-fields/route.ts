import { z } from "zod";

import { requireAdminSession, requireIdentity } from "@/lib/api-auth";
import {
  createCustomFieldDefinition,
  customFieldHttpError,
  listCustomFieldDefinitions,
} from "@/lib/custom-fields";
import { customFieldEntityTypes } from "@/lib/custom-field-contract";
import { customFieldDefinitionCreateSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const querySchema = z
  .object({
    entityType: z.enum(customFieldEntityTypes).optional(),
    includeArchived: z.enum(["true", "false"]).optional().default("false"),
  })
  .strict();

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    entityType: url.searchParams.get("entityType") ?? undefined,
    includeArchived: url.searchParams.get("includeArchived") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid custom field query.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const definitions = await listCustomFieldDefinitions({
      entityType: parsed.data.entityType,
      includeArchived: parsed.data.includeArchived === "true",
    });
    return Response.json({ definitions });
  } catch {
    return Response.json(
      { error: "Unable to load custom field definitions." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authorization = await requireAdminSession(request);
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = customFieldDefinitionCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid custom field definition.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const definition = await createCustomFieldDefinition(
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ definition }, { status: 201 });
  } catch (error) {
    const failure = customFieldHttpError(
      error,
      "Unable to create the custom field definition.",
    );
    return Response.json(
      {
        error: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
      },
      { status: failure.status },
    );
  }
}
