import { getAiPromptSettings } from "@/lib/ai-prompt-store";
import { inventoryAiEnvironment } from "@/lib/inventory-ai-settings";
import { getAiCostEstimateCatalog } from "@/lib/ai-cost-estimates";
import { requirePermission } from "@/lib/api-auth";
import { getImageGenerationModelCatalog } from "@/lib/image-generation-models";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "ai.images");
  if (authorization.response) return authorization.response;

  const { inventorySettings } = await getAiPromptSettings(authorization.identity.organizationId);
  const catalog = getImageGenerationModelCatalog();
  const effective = getAiCostEstimateCatalog({ ...process.env, ...inventoryAiEnvironment(inventorySettings) });
  for (const key of ["inventoryAnalysis", "inventoryResearch"] as const) {
    delete catalog.costEstimates.operations[key];
    if (effective.operations[key]) catalog.costEstimates.operations[key] = effective.operations[key];
  }
  return Response.json(catalog, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
