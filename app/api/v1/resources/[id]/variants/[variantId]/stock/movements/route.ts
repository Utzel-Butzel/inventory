import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import { resourceVariantMovementSchema } from "@/lib/resource-variant-contract";
import {
  bookResourceVariantMovement,
  resourceVariantHttpError,
} from "@/lib/resource-variants";

type Context = { params: Promise<{ id: string; variantId: string }> };

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  const { id, variantId } = await context.params;
  if (![id, variantId].every((value) => z.string().uuid().safeParse(value).success)) {
    return Response.json({ error: "Invalid resource or variant id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "stock.manage",
    id,
  );
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = resourceVariantMovementSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid variant stock movement.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    return Response.json(
      await bookResourceVariantMovement(
        authorization.identity.organizationId,
        id,
        variantId,
        parsed.data,
        authorization.identity.subject,
      ),
      { status: 201 },
    );
  } catch (error) {
    const failure = resourceVariantHttpError(
      error,
      "Unable to book variant stock movement.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
