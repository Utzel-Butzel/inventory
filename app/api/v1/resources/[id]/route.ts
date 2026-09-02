import { isDeepStrictEqual } from "node:util";

import {
  canAccessResource,
  requirePermission,
  requireResourceReferencePermission,
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
import {
  isResourceSlugConflict,
} from "@/lib/resource-slug-contract";
import { resolveResourceId } from "@/lib/resource-slugs";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  const { id: reference } = await context.params;
  const id = await resolveResourceId(
    authorization.identity.organizationId,
    reference,
  );
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });
  const resource = await getResource(
    authorization.identity.organizationId,
    id,
  );
  if (!resource) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const localized = await localizeResource(
      authorization.identity.organizationId,
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
      ai: (
        await Promise.all([
          canAccessResource(authorization.identity, "ai.analyze", resource),
          canAccessResource(authorization.identity, "ai.research", resource),
          canAccessResource(authorization.identity, "ai.images", resource),
          canAccessResource(authorization.identity, "ai.translate", resource),
        ])
      ).some(Boolean),
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
  const { id: reference } = await context.params;
  const authorization = await requireResourceReferencePermission(
    request,
    "inventory.update",
    reference,
  );
  if (authorization.response) return authorization.response;
  const id = authorization.resource.id;

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
  const { slugs, ...resourcePatch } = parsed.data;
  if (resourcePatch.quantity !== undefined) {
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
    if (resourcePatch.type !== undefined) {
      await assertActiveInventoryType(
        authorization.identity.organizationId,
        resourcePatch.type,
      );
    }
    if (resourcePatch.sku !== undefined || resourcePatch.barcode !== undefined) {
      await assertResourceIdentifiersAvailable(
        authorization.identity.organizationId,
        resourcePatch,
        id,
      );
    }
    const validateCustomFields =
      resourcePatch.customFields !== undefined ||
      resourcePatch.type !== undefined ||
      resourcePatch.categories !== undefined;
    const values = {
      ...resourcePatch,
      ...(resourcePatch.mapFeatures !== undefined
        ? positionFromMapFeatures(resourcePatch.mapFeatures)
        : {}),
    };
    const resource = await updateResourceWithCustomFieldValidation({
      organizationId: authorization.identity.organizationId,
      id,
      values,
      slugs,
      validateCustomFields,
      customFieldsProvided: resourcePatch.customFields !== undefined,
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
      await synchronizeSpatialContainment(
        authorization.identity.organizationId,
        authorization.identity.subject,
      );
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
    if (isResourceSlugConflict(error)) {
      return Response.json(
        { error: "That slug is already in use." },
        { status: 409 },
      );
    }
    const duplicateSku = message.includes("resources_sku_unique");
    return Response.json(
      { error: duplicateSku ? "That SKU is already in use." : message },
      { status: duplicateSku ? 409 : 500 },
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id: reference } = await context.params;
  const authorization = await requireResourceReferencePermission(
    request,
    "inventory.delete",
    reference,
  );
  if (authorization.response) return authorization.response;
  const id = authorization.resource.id;
  let resource;
  try {
    resource = await deleteResource(
      authorization.identity.organizationId,
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
    if (message.includes("RESOURCE_HAS_FIRST_CLASS_VARIANTS")) {
      return Response.json(
        {
          error:
            "This primary item still has linked variants. Archive it or handle the variants first.",
        },
        { status: 409 },
      );
    }
    if (message.includes("RESOURCE_USED_BY_OPTION_SELECTION")) {
      return Response.json(
        {
          error:
            "This item is used by a generated option configuration. Detach or remove that configuration first.",
        },
        { status: 409 },
      );
    }
    if (message.includes("RESOURCE_REQUIRED_BY_OPTION_GROUP")) {
      return Response.json(
        {
          error:
            "Deleting this item would leave an option group with fewer than two choices. Add another choice or remove the option group first.",
        },
        { status: 409 },
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
