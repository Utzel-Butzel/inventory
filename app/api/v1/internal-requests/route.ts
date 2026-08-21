import { requirePermission } from "@/lib/api-auth";
import {
  internalRequestCreateSchema,
  internalRequestStatusFilterSchema,
} from "@/lib/internal-request-contract";
import {
  createInternalRequest,
  internalRequestHttpError,
  listInternalRequests,
} from "@/lib/internal-requests";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "requests.read");
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const status = rawStatus
    ? internalRequestStatusFilterSchema.safeParse(rawStatus)
    : null;
  if (status && !status.success) {
    return Response.json({ error: "Invalid request status." }, { status: 422 });
  }
  const limit = Number(url.searchParams.get("limit") ?? "100");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return Response.json({ error: "limit must be between 1 and 200." }, { status: 422 });
  }
  const identity = authorization.identity;
  try {
    const result = await listInternalRequests(
      identity.organizationId,
      {
        subject: identity.subject,
        userId: identity.userId,
        canManage: identity.permissions.includes("requests.manage"),
      },
      {
        status: status?.success ? status.data : undefined,
        limit,
        mine: url.searchParams.get("mine") === "true",
      },
    );
    return Response.json({
      ...result,
      capabilities: {
        ...result.capabilities,
        canCreate:
          identity.permissions.includes("requests.create") &&
          identity.permissions.includes("inventory.read"),
      },
    });
  } catch (error) {
    const failure = internalRequestHttpError(error, "Unable to load internal requests.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "requests.create");
  if (authorization.response) return authorization.response;
  if (!authorization.identity.permissions.includes("inventory.read")) {
    return Response.json(
      { error: "Inventory read access is required to create a request." },
      { status: 403 },
    );
  }
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key is required for an internal request." },
      { status: 400 },
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = internalRequestCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid internal request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const identity = authorization.identity;
  try {
    const result = await createInternalRequest(
      identity.organizationId,
      {
        ...parsed.data,
        startsAt: new Date(parsed.data.startsAt),
        dueAt: new Date(parsed.data.dueAt),
      },
      {
        subject: identity.subject,
        name: identity.name,
        userId: identity.userId,
        canManage: identity.permissions.includes("requests.manage"),
      },
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: identity.subject,
          request: parsed.data,
        }),
      },
    );
    return Response.json(
      { request: result.request },
      {
        status: result.replayed ? 200 : 201,
        headers: idempotencyResponseHeaders(idempotency.key, result.replayed),
      },
    );
  } catch (error) {
    const failure = internalRequestHttpError(error, "Unable to create this request.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
