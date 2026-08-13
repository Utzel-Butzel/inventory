import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { roomLayoutTransformPatchSchema } from "@/lib/room-scene-contract";
import { updateRoomLayoutTransform } from "@/lib/room-scans";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  const authorization = await requirePermission(request, "spatial.manage");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid room scan identifier." }, { status: 422 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON room layout." }, { status: 400 });
  }
  const parsed = roomLayoutTransformPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid room layout transform.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const scan = await updateRoomLayoutTransform(
    authorization.identity.organizationId,
    id,
    parsed.data.transform,
  );
  if (!scan) return Response.json({ error: "Room scan not found." }, { status: 404 });
  return Response.json({ scan });
}
