import { z } from "zod";

import { requireIdentity } from "@/lib/api-auth";
import { getRoomScene } from "@/lib/room-scans";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid room scan identifier." }, { status: 422 });
  }
  const scene = await getRoomScene(id);
  if (!scene) return Response.json({ error: "Room scan not found." }, { status: 404 });
  return Response.json({ scene });
}
