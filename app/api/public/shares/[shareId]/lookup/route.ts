import { z } from "zod";

import {
  AmbiguousResourceCodeError,
  lookupResourceByCode,
} from "@/lib/resource-lookup";
import {
  publicShareAllowsResource,
} from "@/lib/public-shares";
import {
  publicShareNoStoreHeaders,
  requirePublicStockShare,
} from "@/lib/public-share-session";

type Context = { params: Promise<{ shareId: string }> };

export const dynamic = "force-dynamic";

const codeSchema = z.string().trim().min(1).max(2_048);

export async function GET(request: Request, context: Context) {
  const { shareId } = await context.params;
  const authorization = await requirePublicStockShare(request, shareId);
  if (authorization.response) return authorization.response;
  const code = codeSchema.safeParse(new URL(request.url).searchParams.get("code"));
  if (!code.success) {
    return Response.json(
      { error: "Scan or enter a product code." },
      { status: 400, headers: publicShareNoStoreHeaders() },
    );
  }
  try {
    const result = await lookupResourceByCode(
      authorization.share.organizationId,
      code.data,
    );
    if (
      !result ||
      !(await publicShareAllowsResource(authorization.share, result.resource.id))
    ) {
      return Response.json(
        { error: "No shared inventory item matches this code." },
        { status: 404, headers: publicShareNoStoreHeaders() },
      );
    }
    return Response.json(
      {
        resource: {
          id: result.resource.id,
          name: result.resource.name,
          quantity: result.resource.quantity,
        },
        matchedBy: result.matchedBy,
        variantId:
          "variant" in result && result.variant ? result.variant.id : null,
      },
      { headers: publicShareNoStoreHeaders() },
    );
  } catch (error) {
    if (error instanceof AmbiguousResourceCodeError) {
      return Response.json(
        { error: "This code matches more than one inventory item." },
        { status: 409, headers: publicShareNoStoreHeaders() },
      );
    }
    throw error;
  }
}
