import { requireSessionPermission } from "@/lib/api-auth";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import { checkPrintMutation, printFailure } from "@/lib/shared-label-printing";
import { LABEL_WORKSPACE_LIMIT, labelWorkspaceMutationSchema } from "@/lib/label-workspace-contract";
import { readLabelWorkspace, updateLabelWorkspace } from "@/lib/label-workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireSessionPermission(request, "labels.read");
  if (auth.response) return auth.response;
  if (!auth.identity.userId) return Response.json({ error: "User session required." }, { status: 403 });
  try {
    return Response.json(await readLabelWorkspace(auth.identity.organizationId, auth.identity.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return printFailure(error); }
}
export async function PATCH(request: Request) {
  const auth = await requireSessionPermission(request, "labels.read");
  if (auth.response) return auth.response;
  if (!auth.identity.userId) return Response.json({ error: "User session required." }, { status: 403 });
  try {
    checkPrintMutation(request, auth.identity);
    const parsed = labelWorkspaceMutationSchema.safeParse(await boundedPrintJson(request, LABEL_WORKSPACE_LIMIT));
    if (!parsed.success) return Response.json({ error: "Invalid label workspace." }, { status: 422 });
    const saved = await updateLabelWorkspace(auth.identity.organizationId, auth.identity.userId, parsed.data);
    return Response.json(parsed.data.action === "preferences" ? { preferences: saved.preferences } : saved);
  } catch (error) { return printFailure(error); }
}
