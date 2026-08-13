import { isDeepStrictEqual } from "node:util";

import {
  canAccessResource,
  requirePermission,
  requireResourcePermission,
} from "@/lib/api-auth";
import {
  deleteResource,
  getResource,
  updateResourceWithCustomFieldValidation,
} from "@/lib/resources";
import { deleteStoredMedia } from "@/lib/storage";
import { resourcePatchSchema } from "@/lib/validators";
import { positionFromMapFeatures } from "@/lib/map-features";
import { customFieldHttpError } from "@/lib/custom-fields";
import {
  assertActiveInventoryType,
  inventoryStructureHttpError,
  synchronizeSpatialContainment,
} from "@/lib/inventory-structure";
import {
  TranslationLanguageError,
  localizeResource,
} from "@/lib/content-translations";
import {
  assertResourceIdentifiersAvailable,
  ResourceIdentifierConflictError,
} from "@/lib/resource-identifiers";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  const resource = await getResource(id);
  if (!resource) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const localized = await localizeResource(
      resource,
      new URL(request.url).searchParams.get("language"),
    );
    const access = {
      update: await canAccessResource(
        authorization.identity,
        "inventory.update",
        resource,
      ),
      delete: await canAccessResource(
        authorization.identity,
        "inventory.delete",
        resource,
      ),
      stock: await canAccessResource(
        authorization.identity,
        "stock.manage",
        resource,
      ),
      assignments: await canAccessResource(
        authorization.identity,
        "assignments.manage",
        resource,
      ),
      counts: await canAccessResource(
        authorization.identity,
        "counts.manage",
        resource,
      ),
      spatial: await canAccessResource(
        authorization.identity,
        "spatial.manage",
        resource,
      ),
      ai: await canAccessResource(authorization.identity, "ai.use", resource),
    };
    return Response.json({ ...localized, access }, {
      headers: { "Content-Language": localized.localization.languageCode },
    });
  } catch (error) {
    if (error instanceof TranslationLanguageError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id,
  );
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = resourcePatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid inventory item.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  if (!Object.keys(parsed.data).length) {
    return Response.json({ error: "No fields to update." }, { status: 400 });
  }
  if (parsed.data.quantity !== undefined) {
    return Response.json(
      {
        error:
          "Quantity changes require a dated stock booking at /api/v1/resources/{id}/stock/movements.",
      },
      { status: 409 },
    );
  }
  let spatialDataChanged = false;

  try {
    if (parsed.data.type !== undefined) {
      await assertActiveInventoryType(parsed.data.type);
    }
    if (parsed.data.sku !== undefined || parsed.data.barcode !== undefined) {
      await assertResourceIdentifiersAvailable(parsed.data, id);
    }
    const validateCustomFields =
      parsed.data.customFields !== undefined ||
      parsed.data.type !== undefined ||
      parsed.data.categories !== undefined;
    const values = {
      ...parsed.data,
      ...(parsed.data.mapFeatures !== undefined
        ? positionFromMapFeatures(parsed.data.mapFeatures)
        : {}),
    };
    const resource = await updateResourceWithCustomFieldValidation({
      id,
      values,
      validateCustomFields,
      customFieldsProvided: parsed.data.customFields !== undefined,
      actor: authorization.identity.subject,
      authorize: async (current, proposed) => {
        const canUpdate =
          (await canAccessResource(
            authorization.identity,
            "inventory.update",
            current,
          )) &&
          (await canAccessResource(
            authorization.identity,
            "inventory.update",
            proposed,
          ));
        if (!canUpdate) return false;
        spatialDataChanged =
          current.type !== proposed.type ||
          current.gpsLatitude !== proposed.gpsLatitude ||
          current.gpsLongitude !== proposed.gpsLongitude ||
          current.gpsAltitude !== proposed.gpsAltitude ||
          !isDeepStrictEqual(current.mapFeatures, proposed.mapFeatures);
        if (!spatialDataChanged) return true;

        const canUpdateSpatialData =
          (await canAccessResource(
            authorization.identity,
            "spatial.manage",
            current,
          )) &&
          (await canAccessResource(
            authorization.identity,
            "spatial.manage",
            proposed,
          ));
        if (!canUpdateSpatialData) {
          throw new Error("SPATIAL_PERMISSION_DENIED");
        }
        return true;
      },
    });
    if (!resource) return Response.json({ error: "Not found" }, { status: 404 });
    if (spatialDataChanged) {
      await synchronizeSpatialContainment(authorization.identity.subject);
    }
    const translationRelevant = [
      "name",
      "description",
      "notes",
      "customFields",
      "type",
      "categories",
    ].some((field) => Object.hasOwn(parsed.data, field));
    const translation = {
      status: translationRelevant ? ("queued" as const) : ("not_needed" as const),
    };
    return Response.json({ resource, translation });
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
    const message = error instanceof Error ? error.message : "Unable to update item.";
    if (message.includes("SPATIAL_PERMISSION_DENIED")) {
      return Response.json(
        {
          error:
            "You do not have permission to change spatial data for this item.",
        },
        { status: 403 },
      );
    }
    if (message.includes("RESOURCE_PERMISSION_DENIED")) {
      return Response.json(
        {
          error:
            "This update would move the item outside the inventory rule that grants your access.",
        },
        { status: 403 },
      );
    }
    if (message.includes("RESOURCE_HAS_ROOM_SCANS")) {
      return Response.json(
        { error: "A scanned room must keep the place type." },
        { status: 409 },
      );
    }
    if (error instanceof ResourceIdentifierConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    const duplicateSku = message.includes("resources_sku_unique");
    return Response.json(
      { error: duplicateSku ? "That SKU is already in use." : message },
      { status: duplicateSku ? 409 : 500 },
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const authorization = await requireResourcePermission(
    request,
    "inventory.delete",
    id,
  );
  if (authorization.response) return authorization.response;
  let resource;
  try {
    resource = await deleteResource(
      id,
      (current) =>
        canAccessResource(
          authorization.identity,
          "inventory.delete",
          current,
        ),
      authorization.identity.subject,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("RESOURCE_PERMISSION_DENIED")) {
      return Response.json(
        { error: "You do not have permission to delete this item." },
        { status: 403 },
      );
    }
    const referenced =
      message.includes("bom_lines_component_resource_id") ||
      message.includes("assembly_builds_assembly_resource_id") ||
      message.includes("purchase_order_lines_resource_id") ||
      message.includes("violates foreign key constraint");
    return Response.json(
      {
        error: referenced
          ? "This item is referenced by a bill of materials, completed build, or purchase order. Archive it instead, or remove open references first."
          : "Unable to delete this inventory item.",
      },
      { status: referenced ? 409 : 500 },
    );
  }
  if (!resource) return Response.json({ error: "Not found" }, { status: 404 });

  await Promise.allSettled(
    [...resource.media, ...resource.roomScanAssets].map((item) =>
      deleteStoredMedia(item),
    ),
  );
  return new Response(null, { status: 204 });
}
