import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import {
  getStockLocationBreakdown,
  listStockLocationResources,
} from "@/lib/stock-locations";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid resource id." }, { status: 422 });
  const authorization = await requireResourcePermission(
    request,
    "stock.read",
    id.data,
  );
  if (authorization.response) return authorization.response;
  const [breakdown, availableLocations] = await Promise.all([
    getStockLocationBreakdown(
      authorization.identity.organizationId,
      id.data,
    ),
    listStockLocationResources(authorization.identity.organizationId),
  ]);
  if (!breakdown) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ breakdown, availableLocations });
}
