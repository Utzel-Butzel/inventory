import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import { getStockDetail } from "@/lib/stock";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "stock.read",
    id,
  );
  if (authorization.response) return authorization.response;

  try {
    const detail = await getStockDetail(
      authorization.identity.organizationId,
      id,
    );
    if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(detail);
  } catch {
    return Response.json(
      { error: "Unable to load stock for this item." },
      { status: 500 },
    );
  }
}
