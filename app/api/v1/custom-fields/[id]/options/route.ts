import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  customFieldHttpError,
  listCustomFieldReferenceOptions,
} from "@/lib/custom-fields";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const querySchema = z.object({
  query: z.string().trim().max(120).optional(),
  selectedIds: z.array(z.string().uuid()).max(100),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;

  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid definition id." }, { status: 422 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    query: url.searchParams.get("q") ?? undefined,
    selectedIds: url.searchParams.getAll("selected"),
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid reference option query.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await listCustomFieldReferenceOptions({
      organizationId: authorization.identity.organizationId,
      definitionId: id.data,
      query: parsed.data.query,
      selectedIds: parsed.data.selectedIds,
      limit: parsed.data.limit,
    });
    return Response.json({ options: result.options });
  } catch (error) {
    const failure = customFieldHttpError(
      error,
      "Unable to load reference options.",
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
