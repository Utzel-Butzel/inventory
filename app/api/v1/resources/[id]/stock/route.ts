import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { getStockDetail } from "@/lib/stock";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "stock.read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }

  try {
    const detail = await getStockDetail(id);
    if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(detail);
  } catch {
    return Response.json(
      { error: "Unable to load stock for this item." },
      { status: 500 },
    );
  }
}
