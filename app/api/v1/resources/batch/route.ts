import { canAccessResource, requireIdentity } from "@/lib/api-auth";
import { getResourceRecords } from "@/lib/access-control";
import {
  assertActiveInventoryType,
  inventoryStructureHttpError,
  synchronizeSpatialContainment,
} from "@/lib/inventory-structure";
import { updateResourcesBatch } from "@/lib/resources";
import { resourceBatchPatchSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }

  const parsed = resourceBatchPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid batch update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const selectedResources = await getResourceRecords(
    parsed.data.ids,
    authorization.identity.organizationId,
  );
  if (selectedResources.length !== new Set(parsed.data.ids).size) {
    return Response.json(
      { error: "At least one selected inventory item no longer exists." },
      { status: 404 },
    );
  }
  const allowed = await Promise.all(
    selectedResources.map((resource) =>
      canAccessResource(authorization.identity, "inventory.update", resource),
    ),
  );
  if (allowed.some((value) => !value)) {
    return Response.json(
      { error: "You do not have permission to update every selected item." },
      { status: 403 },
    );
  }

  try {
    if (parsed.data.changes.type) {
      await assertActiveInventoryType(
        authorization.identity.organizationId,
        parsed.data.changes.type,
      );
    }
    const result = await updateResourcesBatch({
      ...parsed.data,
      organizationId: authorization.identity.organizationId,
      actor: authorization.identity.subject,
      authorize: async (current, proposed) =>
        (await canAccessResource(
          authorization.identity,
          "inventory.update",
          current,
        )) &&
        (await canAccessResource(
          authorization.identity,
          "inventory.update",
          proposed,
        )),
    });
    if (parsed.data.changes.type) {
      await synchronizeSpatialContainment(
        authorization.identity.organizationId,
        authorization.identity.subject,
      );
    }
    return Response.json(result);
  } catch (error) {
    const structureFailure = inventoryStructureHttpError(error, "");
    if (structureFailure.status !== 500) {
      return Response.json(
        { error: structureFailure.message },
        { status: structureFailure.status },
      );
    }
    if (error instanceof Error && error.message === "BATCH_RESOURCE_NOT_FOUND") {
      return Response.json(
        { error: "At least one selected inventory item no longer exists." },
        { status: 404 },
      );
    }
    if (error instanceof Error && error.message === "RESOURCE_PERMISSION_DENIED") {
      return Response.json(
        {
          error:
            "A batch change cannot move an item outside the inventory rule that grants your access.",
        },
        { status: 403 },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update selected items." },
      { status: 500 },
    );
  }
}
