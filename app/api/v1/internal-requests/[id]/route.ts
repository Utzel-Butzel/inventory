import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { internalRequestActionSchema } from "@/lib/internal-request-contract";
import {
  getInternalRequest,
  internalRequestHttpError,
  transitionInternalRequest,
} from "@/lib/internal-requests";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "requests.read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid request id." }, { status: 422 });
  }
  const identity = authorization.identity;
  try {
    const internalRequest = await getInternalRequest(identity.organizationId, id, {
      subject: identity.subject,
      userId: identity.userId,
      canManage: identity.permissions.includes("requests.manage"),
    });
    if (!internalRequest) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ request: internalRequest });
  } catch (error) {
    const failure = internalRequestHttpError(error, "Unable to load this request.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requirePermission(request, "requests.read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid request id." }, { status: 422 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = internalRequestActionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request action.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const identity = authorization.identity;
  const canManage = identity.permissions.includes("requests.manage");
  if (parsed.data.action !== "cancel" && !canManage) {
    return Response.json(
      { error: "Request management access is required for this action." },
      { status: 403 },
    );
  }
  try {
    const internalRequest = await transitionInternalRequest(
      identity.organizationId,
      id,
      parsed.data.action,
      parsed.data.note ?? "",
      {
        subject: identity.subject,
        name: identity.name,
        userId: identity.userId,
        canManage,
      },
    );
    return Response.json({ request: internalRequest });
  } catch (error) {
    const failure = internalRequestHttpError(error, "Unable to update this request.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
