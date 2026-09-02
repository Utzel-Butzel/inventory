import { z } from "zod";

import {
  listPublicShareFilterOptions,
  listPublicShareResources,
} from "@/lib/public-shares";
import {
  publicShareNoStoreHeaders,
  requirePublicStockShare,
} from "@/lib/public-share-session";

type Context = { params: Promise<{ shareId: string }> };

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(240).optional().default(""),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  status: z.string().trim().max(32).optional().default(""),
  type: z.string().trim().max(64).optional().default(""),
  stock: z.enum(["all", "in-stock", "out-of-stock"]).optional().default("all"),
  sort: z
    .enum(["updated", "name", "quantity-asc", "quantity-desc"])
    .optional()
    .default("updated"),
});

export async function GET(request: Request, context: Context) {
  const { shareId } = await context.params;
  const authorization = await requirePublicStockShare(request, shareId);
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid catalogue filters." },
      { status: 422, headers: publicShareNoStoreHeaders() },
    );
  }
  const [result, filters] = await Promise.all([
    listPublicShareResources({
      share: authorization.share,
      ...parsed.data,
    }),
    listPublicShareFilterOptions(authorization.share),
  ]);
  return Response.json(
    { ...result, filters },
    { headers: publicShareNoStoreHeaders() },
  );
}
