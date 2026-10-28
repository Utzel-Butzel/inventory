import { hashRequestIdentity, requirePermission, requireResourcePermission } from "@/lib/api-auth";
import { readBulk3dJob, readBulk3dModel, readBulk3dState } from "@/lib/inventory-bulk-3d-jobs";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = await requirePermission(request, "ai.count");
  if (auth.response) return auth.response;
  const { jobId } = await context.params;
  const owner = await readBulk3dJob(jobId);
  if (!owner || owner.organizationId !== auth.identity.organizationId || owner.actorHash !== hashRequestIdentity(auth.identity)) return json({ code: "notFound" }, 404);
  const itemAuth = await requireResourcePermission(request, "ai.count", owner.resourceId);
  if (itemAuth.response) return itemAuth.response;
  if (owner.expiresAt < Date.now()) return json({ code: "expired" }, 410);
  const state = await readBulk3dState(jobId, owner.createdAt);
  if (new URL(request.url).searchParams.get("asset") === "model") {
    if (state.status !== "completed") return json({ code: "processing" }, 409);
    try {
      const bytes = await readBulk3dModel(jobId);
      return new Response(new Uint8Array(bytes), { headers: {
        "Content-Type": "model/gltf-binary", "Content-Length": String(bytes.length),
        "Content-Disposition": 'attachment; filename="inventory-reconstruction.glb"',
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      } });
    } catch { return json({ code: "unavailable" }, 503); }
  }
  return json(state);
}
