import { requireIdentity } from "@/lib/api-auth";
import { getInventoryCountModelCatalog } from "@/lib/inventory-count-models";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "ai");
  if (authorization.response) return authorization.response;

  return Response.json(getInventoryCountModelCatalog(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
