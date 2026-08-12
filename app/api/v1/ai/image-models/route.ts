import { requireIdentity } from "@/lib/api-auth";
import { getImageGenerationModelCatalog } from "@/lib/image-generation-models";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "ai");
  if (authorization.response) return authorization.response;

  return Response.json(getImageGenerationModelCatalog(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
