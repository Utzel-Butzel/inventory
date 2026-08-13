import { z } from "zod";

import {
  requirePermission,
  requireResourcePermission,
} from "@/lib/api-auth";
import {
  getInventoryCycle,
  saveInventoryCyclePolicy,
} from "@/lib/inventory-cycles";
import { stockHttpError } from "@/lib/stock";

type Context = { params: Promise<{ id: string }> };

const policySchema = z
  .object({
    intervalDays: z.number().int().min(1).max(3650),
    enabled: z.boolean().optional().default(true),
  })
  .strict();

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "counts.read");
  if (authorization.response) return authorization.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid resource id." }, { status: 422 });
  const cycle = await getInventoryCycle(id.data);
  if (!cycle) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ cycle });
}

export async function PUT(request: Request, context: Context) {
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid resource id." }, { status: 422 });
  const authorization = await requireResourcePermission(
    request,
    "counts.manage",
    id.data,
  );
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = policySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid inventory cycle.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const policy = await saveInventoryCyclePolicy(
      id.data,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ policy });
  } catch (error) {
    const failure = stockHttpError(error, "Unable to save the inventory cycle.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
