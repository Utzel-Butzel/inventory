import { resourceInputSchema } from "@/lib/validators";
import {
  createResource,
  createResourceIdempotently,
  IdempotencyConflictError,
  listResources,
  replayResourceCreation,
} from "@/lib/resources";
import { requireIdentity } from "@/lib/api-auth";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { positionFromMapFeatures } from "@/lib/map-features";
import {
  customFieldHttpError,
  validateCustomFieldValues,
} from "@/lib/custom-fields";
import {
  assertActiveInventoryType,
  inventoryStructureHttpError,
  synchronizeSpatialContainment,
} from "@/lib/inventory-structure";

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
    const requestHash = hashIdempotentPayload({
      actor: authorization.identity.subject,
      resource: parsed.data,
    });
    if (idempotency.key) {
      const replay = await replayResourceCreation({
        idempotencyKey: idempotency.key,
        requestHash,
      });
      if (replay) {
        return Response.json(replay.response, {
          status: 200,
          headers: idempotencyResponseHeaders(idempotency.key, true),
        });
      }
    }

    await assertActiveInventoryType(parsed.data.type);
    const customFields = await validateCustomFieldValues({
      entityType: "inventory",
      target: { type: parsed.data.type, categories: parsed.data.categories },
      values: parsed.data.customFields ?? {},
      enforceRequired: parsed.data.customFields !== undefined,
    });
    const values = {
      ...parsed.data,
      customFields,
      ...(parsed.data.mapFeatures.length
        ? positionFromMapFeatures(parsed.data.mapFeatures)
        : {}),
      createdBy: authorization.identity.subject,
    };
    if (idempotency.key) {
      const result = await createResourceIdempotently({
        values,
        idempotencyKey: idempotency.key,
        requestHash,
      });
      if (!result.replayed && parsed.data.mapFeatures.length) {
        await synchronizeSpatialContainment(authorization.identity.subject);
      }
      return Response.json(result.response, {
        status: result.replayed ? 200 : 201,
        headers: idempotencyResponseHeaders(
          idempotency.key,
          result.replayed,
        ),
      });
    }

    const resource = await createResource(values);
    if (parsed.data.mapFeatures.length) {
      await synchronizeSpatialContainment(authorization.identity.subject);
    }
    return Response.json({ resource }, { status: 201 });
  } catch (error) {
    const structureFailure = inventoryStructureHttpError(error, "");
    if (structureFailure.status !== 500) {
      return Response.json(
        { error: structureFailure.message },
        { status: structureFailure.status },
      );
    }
    const customFieldFailure = customFieldHttpError(error, "");
    if (customFieldFailure.status !== 500) {
      return Response.json(
        {
          error: customFieldFailure.message,
          ...(customFieldFailure.details
            ? { details: customFieldFailure.details }
            : {}),
        },
        { status: customFieldFailure.status },
      );
    }
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
