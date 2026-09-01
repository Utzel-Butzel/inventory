import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import {
  deleteStockMovement,
  stockHttpError,
  updateStockMovement,
} from "@/lib/stock";
import { manualStockMovementSchema } from "@/lib/stock-movement-contract";

type Context = {
  params: Promise<{ id: string; movementId: string }>;
};

const paramsSchema = z.object({
  id: z.string().uuid(),
  movementId: z.string().uuid(),
});

async function authorize(request: Request, context: Context) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return {
      response: Response.json(
        { error: "Invalid stock movement request." },
        { status: 422 },
      ),
    } as const;
  }
  const authorization = await requireResourcePermission(
    request,
    "stock.manage",
    parsed.data.id,
  );
  if (authorization.response) return authorization;
  return { ...authorization, params: parsed.data } as const;
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await authorize(request, context);
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
  const parsed = manualStockMovementSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid stock movement.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await updateStockMovement(
      authorization.identity.organizationId,
      authorization.params.id,
      authorization.params.movementId,
      {
        ...parsed.data,
        occurredAt: parsed.data.occurredAt
          ? new Date(parsed.data.occurredAt)
          : undefined,
      },
    );
    return Response.json(result);
  } catch (error) {
    const failure = stockHttpError(
      error,
      "Unable to update this stock movement.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await authorize(request, context);
  if (authorization.response) return authorization.response;

  try {
    await deleteStockMovement(
      authorization.identity.organizationId,
      authorization.params.id,
      authorization.params.movementId,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    const failure = stockHttpError(
      error,
      "Unable to delete this stock movement.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
