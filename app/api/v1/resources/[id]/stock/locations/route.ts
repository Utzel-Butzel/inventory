import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  getStockLocationBreakdown,
  listStockLocationResources,
} from "@/lib/stock-locations";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "stock.read");
  if (authorization.response) return authorization.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid resource id." }, { status: 422 });
  const [breakdown, availableLocations] = await Promise.all([
    getStockLocationBreakdown(id.data),
    listStockLocationResources(),
  ]);
  if (!breakdown) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ breakdown, availableLocations });
}
