import { resourceInputSchema } from "@/lib/validators";
import {
  createResource,
  createResourceIdempotently,
  IdempotencyConflictError,
  listResources,
} from "@/lib/resources";
import { requireIdentity } from "@/lib/api-auth";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "24");
  const result = await listResources({
    query: url.searchParams.get("q") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 24,
  });
  return Response.json(result);
}

export async function POST(request: Request) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = resourceInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid inventory item.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const values = {
      ...parsed.data,
      createdBy: authorization.identity.subject,
    };
    if (idempotency.key) {
      const result = await createResourceIdempotently({
        values,
        idempotencyKey: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: authorization.identity.subject,
          resource: parsed.data,
        }),
      });
      return Response.json(result.response, {
        status: result.replayed ? 200 : 201,
        headers: idempotencyResponseHeaders(
          idempotency.key,
          result.replayed,
        ),
      });
    }

    const resource = await createResource(values);
    return Response.json({ resource }, { status: 201 });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Unable to create item.";
    const duplicateSku = message.includes("resources_sku_unique");
    return Response.json(
      { error: duplicateSku ? "That SKU is already in use." : message },
      { status: duplicateSku ? 409 : 500 },
    );
  }
}
