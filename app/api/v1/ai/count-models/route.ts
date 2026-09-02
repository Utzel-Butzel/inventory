import { requirePermission } from "@/lib/api-auth";
import { getInventoryCountModelCatalog } from "@/lib/inventory-count-models";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "ai.count");
  if (authorization.response) return authorization.response;

  return Response.json(getInventoryCountModelCatalog(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
