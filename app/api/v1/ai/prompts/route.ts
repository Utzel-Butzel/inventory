import { getAiCostEstimateCatalog } from "@/lib/ai-cost-estimates";
import { inventoryAiEnvironment } from "@/lib/inventory-ai-settings";
import { inventoryAiSettingsSchema } from "@/lib/inventory-ai-settings";
import { z } from "zod";
import { requireIdentity, requirePermission } from "@/lib/api-auth";
import { aiPromptCollectionSchema } from "@/lib/ai-prompt-templates";
import {
  getAiPromptSettings,
  saveAiPromptSettings,
} from "@/lib/ai-prompt-store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const inputSchema = z
  .object({
    collection: aiPromptCollectionSchema,
    inventorySettings: inventoryAiSettingsSchema.optional(),
    revision: z.number().int().min(0).max(2_147_483_646),
  })
  .strict();
export async function GET(request: Request) {
  const authorization = await requireIdentity(request);
  if (authorization.response) return authorization.response;
  const settings = await getAiPromptSettings(authorization.identity.organizationId);
  const estimates = getAiCostEstimateCatalog(inventoryAiEnvironment(settings.inventorySettings));
  return Response.json(
    { ...settings, costEstimates: { inventoryAnalysis: estimates.operations.inventoryAnalysis, inventoryResearch: estimates.operations.inventoryResearch } },
    { headers },
  );
}
export async function PUT(request: Request) {
  const authorization = await requirePermission(request, "roles.manage");
  if (authorization.response) return authorization.response;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Invalid prompt templates.", details: parsed.error.flatten() },
      { status: 422, headers },
    );
  const result = await saveAiPromptSettings(
    authorization.identity.organizationId,
    parsed.data.collection,
    parsed.data.revision,
    parsed.data.inventorySettings,
  );
  if (!result)
    return Response.json(
      {
        error: "The prompt templates have changed. Reload before saving.",
        code: "REVISION_CONFLICT",
      },
      { status: 409, headers },
    );
  return Response.json(result, { headers });
}
