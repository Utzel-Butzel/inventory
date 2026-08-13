import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import { spatialPlacementInputSchema } from "@/lib/room-scene-contract";
import {
  deleteSpatialPlacement,
  upsertSpatialPlacement,
} from "@/lib/room-scans";

type Context = { params: Promise<{ id: string; resourceId: string }> };

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: Context) {
  const { id, resourceId } = await context.params;
  const authorization = await requireResourcePermission(
    request,
    "spatial.manage",
    resourceId,
  );
  if (authorization.response) return authorization.response;
  const identifiers = z
    .object({ id: z.uuid(), resourceId: z.uuid() })
    .safeParse({ id, resourceId });
  if (!identifiers.success) {
    return Response.json({ error: "Invalid room scan or item identifier." }, { status: 422 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON placement." }, { status: 400 });
  }
  const parsed = spatialPlacementInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid spatial placement.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const result = await upsertSpatialPlacement({
    scanId: id,
    resourceId,
    placement: parsed.data,
    actor: authorization.identity.subject,
  });
  if (result.kind === "scan-not-found") {
    return Response.json({ error: "Room scan not found." }, { status: 404 });
  }
  if (result.kind === "resource-not-found") {
    return Response.json({ error: "Inventory item not found." }, { status: 404 });
  }
  if (result.kind === "keyframe-not-found") {
    return Response.json(
      { error: "The matched camera keyframe does not belong to this room scan." },
      { status: 422 },
    );
  }
  if (result.kind === "scan-superseded") {
    return Response.json(
      { error: "This room scan was replaced. Relocalize against the active scan." },
      { status: 409 },
    );
  }
  return Response.json({ placement: result.placement });
}

export async function DELETE(request: Request, context: Context) {
  const { id, resourceId } = await context.params;
  const authorization = await requireResourcePermission(
    request,
    "spatial.manage",
    resourceId,
  );
  if (authorization.response) return authorization.response;
  const identifiers = z
    .object({ id: z.uuid(), resourceId: z.uuid() })
    .safeParse({ id, resourceId });
  if (!identifiers.success) {
    return Response.json({ error: "Invalid room scan or item identifier." }, { status: 422 });
  }
  const deleted = await deleteSpatialPlacement(resourceId, id);
  if (!deleted) return Response.json({ error: "Placement not found." }, { status: 404 });
  return new Response(null, { status: 204 });
}
