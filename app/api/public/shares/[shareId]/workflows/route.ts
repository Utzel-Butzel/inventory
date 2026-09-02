import { listPublicShareWorkflows } from "@/lib/public-shares";
import {
  publicShareNoStoreHeaders,
  requirePublicStockShare,
} from "@/lib/public-share-session";

type Context = { params: Promise<{ shareId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const { shareId } = await context.params;
  const authorization = await requirePublicStockShare(request, shareId);
  if (authorization.response) return authorization.response;
  return Response.json(
    { workflows: await listPublicShareWorkflows(authorization.share) },
    { headers: publicShareNoStoreHeaders() },
  );
}
