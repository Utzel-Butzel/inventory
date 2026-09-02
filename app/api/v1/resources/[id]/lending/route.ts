import { z } from "zod";

import { lendingSettingsSchema } from "@/lib/lending-contract";
import { requireResourcePermission } from "@/lib/api-auth";
import {
  getResourceLendingSettings,
  updateResourceLendingSettings,
} from "@/lib/resource-lending";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "assignments.read",
    id.data,
  );
  if (authorization.response) return authorization.response;

  const lending = await getResourceLendingSettings(
    authorization.identity.organizationId,
    id.data,
  );
  if (!lending) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ lending }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "assignments.manage",
    id.data,
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
  const parsed = lendingSettingsSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid lending settings.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const lending = await updateResourceLendingSettings(
    authorization.identity.organizationId,
    id.data,
    parsed.data,
    authorization.identity.subject,
  );
  if (!lending) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ lending });
}
