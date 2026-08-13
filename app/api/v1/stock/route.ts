import { requirePermission } from "@/lib/api-auth";
import { getStockOverview } from "@/lib/stock";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "stock.read");
  if (authorization.response) return authorization.response;

  try {
    return Response.json(
      await getStockOverview(authorization.identity.organizationId),
    );
  } catch {
    return Response.json(
      { error: "Unable to load the stock overview." },
      { status: 500 },
    );
  }
}
