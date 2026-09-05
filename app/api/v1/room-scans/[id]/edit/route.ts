import { z } from "zod";
import {
  getRequestIdentity,
  requirePermission,
  requireResourcePermission,
} from "@/lib/api-auth";
import { findRoomScan, getRoomScene } from "@/lib/room-scans";
import { roomEditSchema } from "@/lib/room-scene-editor";
import { editRoomScene } from "@/lib/room-scene-edit-service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "invalid-id" }, { status: 422 });
  const identity = await getRequestIdentity(request);
  if (!identity)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const scan = await findRoomScan(identity.organizationId, id);
  if (!scan) return Response.json({ error: "scan-not-found" }, { status: 404 });
  const authorization = await requireResourcePermission(
    request,
    "spatial.manage",
    scan.roomResourceId,
  );
  if (authorization.response) return authorization.response;
  let raw;
  try {
    const text = await request.text();
    if (text.length > 2_000_000)
      return Response.json({ error: "payload-too-large" }, { status: 413 });
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = roomEditSchema.safeParse(raw);
  if (!parsed.success)
    return Response.json(
      { error: "invalid-edit", details: parsed.error.flatten() },
      { status: 422 },
    );
  if (parsed.data.action === "add" || parsed.data.action === "split") {
    const createPermission = await requirePermission(
      request,
      "inventory.create",
    );
    if (createPermission.response) return createPermission.response;
  }
  try {
    const result = await editRoomScene(
      identity.organizationId,
      id,
      parsed.data,
      identity.subject,
    );
    const scene = await getRoomScene(identity.organizationId, id);
    return Response.json({ ...result, scene });
  } catch (error) {
    const code = error instanceof Error ? error.message : "edit-failed";
    const expected = [
      "revision-conflict",
      "coordinate-frame-changed",
      "split-too-small",
      "split-crosses-furniture",
      "split-missing-floor",
      "invalid-transform",
      "object-not-found",
      "scan-not-found",
    ];
    if (!expected.includes(code)) console.error("Room editing failed", error);
    return Response.json(
      { error: expected.includes(code) ? code : "edit-failed" },
      {
        status:
          code === "revision-conflict"
            ? 409
            : expected.includes(code)
              ? 422
              : 500,
      },
    );
  }
}
