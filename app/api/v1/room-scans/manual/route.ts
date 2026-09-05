import { requirePermission } from "@/lib/api-auth";
import { manualRoomSchema } from "@/lib/room-scene-editor";
import { createManualRoom } from "@/lib/room-scene-edit-service";
export async function POST(request: Request) {
  const authorization = await requirePermission(request, "spatial.manage");
  if (authorization.response) return authorization.response;
  const createPermission = await requirePermission(request, "inventory.create");
  if (createPermission.response) return createPermission.response;
  let raw;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = manualRoomSchema.safeParse(raw);
  if (!parsed.success)
    return Response.json({ error: "invalid-room" }, { status: 422 });
  try {
    const scanId = await createManualRoom(
      authorization.identity.organizationId,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ scanId }, { status: 201 });
  } catch (error) {
    console.error("Manual room creation failed", error);
    return Response.json({ error: "create-failed" }, { status: 500 });
  }
}
