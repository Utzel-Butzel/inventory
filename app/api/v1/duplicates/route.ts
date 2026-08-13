import { z } from "zod";

import { getResourceRecords } from "@/lib/access-control";
import {
  canAccessResource,
  requireIdentity,
  requirePermission,
} from "@/lib/api-auth";
import { findDuplicateResources, mergeResources } from "@/lib/resources";

const mergeSchema = z.object({
  keepResourceId: z.string().uuid(),
  removeResourceId: z.string().uuid(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  return Response.json({ duplicates: await findDuplicateResources() });
}

export async function POST(request: Request) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = mergeSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid merge request." }, { status: 422 });
  }
  const targets = await getResourceRecords([
    parsed.data.keepResourceId,
    parsed.data.removeResourceId,
  ]);
  if (targets.length !== 2) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const [canUpdate, canDelete] = await Promise.all([
    canAccessResource(
      authorization.identity,
      "inventory.update",
      targets.find((resource) => resource.id === parsed.data.keepResourceId)!,
    ),
    canAccessResource(
      authorization.identity,
      "inventory.delete",
      targets.find((resource) => resource.id === parsed.data.removeResourceId)!,
    ),
  ]);
  if (!canUpdate || !canDelete) {
    return Response.json(
      { error: "You do not have permission to merge these inventory items." },
      { status: 403 },
    );
  }
  try {
    const resource = await mergeResources(
      parsed.data.keepResourceId,
      parsed.data.removeResourceId,
      authorization.identity.subject,
      {
        authorizeUpdate: (resource) =>
          canAccessResource(
            authorization.identity,
            "inventory.update",
            resource,
          ),
        authorizeDelete: (resource) =>
          canAccessResource(
            authorization.identity,
            "inventory.delete",
            resource,
          ),
        authorizeOrders: () =>
          authorization.identity.permissions.includes("orders.manage"),
      },
    );
    if (!resource) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ resource });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to merge items.";
    if (message === "RESOURCE_PERMISSION_DENIED") {
      return Response.json(
        {
          error:
            "You do not have permission to merge these inventory items, or the merge would move the kept item outside the inventory rule that grants your access.",
        },
        { status: 403 },
      );
    }
    if (message === "ORDERS_PERMISSION_DENIED") {
      return Response.json(
        {
          error:
            "Merging this item would change purchase orders, which requires permission to manage orders.",
        },
        { status: 403 },
      );
    }
    const stockConflict =
      message.includes("bulk units into serialized stock") ||
      message.includes("no longer exists") ||
      message.includes("circular bill of materials") ||
      message.includes("assembly build history") ||
      message.includes("purchase-order history") ||
      message.includes("3D room scans");
    return Response.json(
      { error: message },
      { status: stockConflict ? 409 : 500 },
    );
  }
}
