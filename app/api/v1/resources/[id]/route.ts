import { requireIdentity } from "@/lib/api-auth";
import { deleteResource, getResource, updateResource } from "@/lib/resources";
import { deleteStoredMedia } from "@/lib/storage";
import { resourcePatchSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  const resource = await getResource(id);
  if (!resource) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ resource });
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;

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

  try {
    const resource = await updateResource(id, parsed.data);
    if (!resource) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ resource });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update item.";
    const duplicateSku = message.includes("resources_sku_unique");
    return Response.json(
      { error: duplicateSku ? "That SKU is already in use." : message },
      { status: duplicateSku ? 409 : 500 },
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  let resource;
  try {
    resource = await deleteResource(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
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
    resource.media.map((item) => deleteStoredMedia(item)),
  );
  return new Response(null, { status: 204 });
}
