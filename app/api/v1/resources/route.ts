import { resourceInputSchema } from "@/lib/validators";
import {
  createResource,
  createResourceIdempotently,
  IdempotencyConflictError,
  listResources,
  replayResourceCreation,
} from "@/lib/resources";
import { requirePermission } from "@/lib/api-auth";
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
  TranslationLanguageError,
  localizeResourceList,
} from "@/lib/content-translations";
import {
  assertActiveInventoryType,
  inventoryStructureHttpError,
  synchronizeSpatialContainment,
} from "@/lib/inventory-structure";
import {
  assertResourceIdentifiersAvailable,
  ResourceIdentifierConflictError,
} from "@/lib/resource-identifiers";
import { DEFAULT_INVENTORY_PAGE_SIZE } from "@/lib/inventory-pagination";
import { isResourceSlugConflict } from "@/lib/resource-slug-contract";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(
    url.searchParams.get("pageSize") ?? DEFAULT_INVENTORY_PAGE_SIZE,
  );
  const result = await listResources({
    organizationId: authorization.identity.organizationId,
    query: url.searchParams.get("q") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    loanable: url.searchParams.get("loanable") === "true",
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize)
      ? pageSize
      : DEFAULT_INVENTORY_PAGE_SIZE,
    mediaMode: url.searchParams.get("media") === "cover" ? "cover" : "all",
  });
  try {
    const localized = await localizeResourceList(
      authorization.identity.organizationId,
      result.resources,
      url.searchParams.get("language"),
    );
    return Response.json({
      ...result,
      resources: localized.resources,
      ...(localized.localization
        ? { localization: localized.localization }
        : {}),
    });
  } catch (error) {
    if (error instanceof TranslationLanguageError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "inventory.create");
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
  const createsSpatialData =
    parsed.data.mapFeatures.length > 0 ||
    (parsed.data.gpsLatitude !== undefined &&
      parsed.data.gpsLatitude !== null) ||
    (parsed.data.gpsLongitude !== undefined &&
      parsed.data.gpsLongitude !== null) ||
    (parsed.data.gpsAltitude !== undefined &&
      parsed.data.gpsAltitude !== null);
  if (
    createsSpatialData &&
    !authorization.identity.permissions.includes("spatial.manage")
  ) {
    return Response.json(
      { error: "You do not have permission to add spatial data." },
      { status: 403 },
    );
  }

  try {
    const { slugs, ...resourceInput } = parsed.data;
    const requestHash = hashIdempotentPayload({
      actor: authorization.identity.subject,
      resource: parsed.data,
    });
    if (idempotency.key) {
      const replay = await replayResourceCreation({
        organizationId: authorization.identity.organizationId,
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

    await assertActiveInventoryType(
      authorization.identity.organizationId,
      resourceInput.type,
    );
    await assertResourceIdentifiersAvailable(
      authorization.identity.organizationId,
      resourceInput,
    );
    const customFields = await validateCustomFieldValues({
      organizationId: authorization.identity.organizationId,
      entityType: "inventory",
      target: { type: resourceInput.type, categories: resourceInput.categories },
      values: resourceInput.customFields ?? {},
      enforceRequired: resourceInput.customFields !== undefined,
    });
    const values = {
      ...resourceInput,
      organizationId: authorization.identity.organizationId,
      customFields,
      ...(resourceInput.mapFeatures.length
        ? positionFromMapFeatures(resourceInput.mapFeatures)
        : {}),
      createdBy: authorization.identity.subject,
    };
    if (idempotency.key) {
      const result = await createResourceIdempotently({
        organizationId: authorization.identity.organizationId,
        values,
        slugs,
        idempotencyKey: idempotency.key,
        requestHash,
        actor: authorization.identity.subject,
      });
      if (
        !result.replayed &&
        (parsed.data.mapFeatures.length > 0 ||
          (parsed.data.gpsLatitude !== null &&
            parsed.data.gpsLatitude !== undefined &&
            parsed.data.gpsLongitude !== null &&
            parsed.data.gpsLongitude !== undefined))
      ) {
        await synchronizeSpatialContainment(
          authorization.identity.organizationId,
          authorization.identity.subject,
        );
      }
      return Response.json(
        {
          ...result.response,
          ...(!result.replayed
            ? { translation: { status: "queued" as const } }
            : {}),
        },
        {
          status: result.replayed ? 200 : 201,
          headers: idempotencyResponseHeaders(
            idempotency.key,
            result.replayed,
          ),
        },
      );
    }

    const resource = await createResource(
      authorization.identity.organizationId,
      values,
      authorization.identity.subject,
      slugs,
    );
    if (
      parsed.data.mapFeatures.length > 0 ||
      (parsed.data.gpsLatitude !== null &&
        parsed.data.gpsLatitude !== undefined &&
        parsed.data.gpsLongitude !== null &&
        parsed.data.gpsLongitude !== undefined)
    ) {
      await synchronizeSpatialContainment(
        authorization.identity.organizationId,
        authorization.identity.subject,
      );
    }
    return Response.json(
      { resource, translation: { status: "queued" as const } },
      { status: 201 },
    );
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
    if (error instanceof ResourceIdentifierConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (isResourceSlugConflict(error)) {
      return Response.json(
        { error: "That slug is already in use." },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to create item.";
    const duplicateSku = message.includes("resources_sku_unique");
    return Response.json(
      { error: duplicateSku ? "That SKU is already in use." : message },
      { status: duplicateSku ? 409 : 500 },
    );
  }
}
