import "server-only";
import { defaultInventoryAiSettings, type InventoryAiSettings } from "@/lib/inventory-ai-settings";
import { and, eq } from "drizzle-orm";
import { aiPromptSettings, resourceTypes } from "@/db/schema";
import { db } from "@/lib/db";
import {
  defaultAiPromptCollection,
  renderAiPrompt,
  selectAiPrompt,
  type AiPromptCollection,
  type AiPromptKind,
  type AiPromptSelection,
} from "@/lib/ai-prompt-templates";

export async function getAiPromptSettings(organizationId: string) {
  const [row] = await db
    .select()
    .from(aiPromptSettings)
    .where(eq(aiPromptSettings.organizationId, organizationId))
    .limit(1);
  return {
    collection: row?.collection ?? defaultAiPromptCollection(),
    inventorySettings: row?.inventorySettings ?? defaultInventoryAiSettings(process.env),
    revision: row?.revision ?? 0,
  };
}
export async function saveAiPromptSettings(
  organizationId: string,
  collection: AiPromptCollection,
  revision: number,
  inventorySettings?: InventoryAiSettings,
) {
  const values = { collection, ...(inventorySettings ? { inventorySettings } : {}), revision: revision + 1, updatedAt: new Date() };
  const rows =
    revision === 0
      ? await db
          .insert(aiPromptSettings)
          .values({ organizationId, ...values })
          .onConflictDoNothing()
          .returning()
      : await db
          .update(aiPromptSettings)
          .set(values)
          .where(
            and(
              eq(aiPromptSettings.organizationId, organizationId),
              eq(aiPromptSettings.revision, revision),
            ),
          )
          .returning();
  return rows[0]
    ? { collection: rows[0].collection, inventorySettings: rows[0].inventorySettings ?? defaultInventoryAiSettings(process.env), revision: rows[0].revision }
    : null;
}
export async function resolveAiPrompt(
  organizationId: string,
  kind: AiPromptKind,
  selection: AiPromptSelection,
  resource: {
    name: string;
    description?: string | null;
    type?: string;
    tags?: string[];
    categories?: Array<string | { name: string }>;
    sku?: string | null;
    barcode?: string | null;
    serialNumber?: string | null;
  },
  settings?: Awaited<ReturnType<typeof getAiPromptSettings>>,
) {
  const { collection, inventorySettings } = settings ?? await getAiPromptSettings(organizationId);
  return renderAiPrompt(selectAiPrompt(collection, kind, selection), {
    name: resource.name.trim() || "inventory item",
    description: resource.description ?? "",
    type: resource.type ?? "",
    tags: resource.tags?.join(", ") ?? "",
    categories:
      resource.categories
        ?.map((category) =>
          typeof category === "string" ? category : category.name,
        )
        .join(", ") ?? "",
    sku: resource.sku ?? "",
    barcode: resource.barcode ?? "",
    serialNumber: resource.serialNumber ?? "",
    language: inventorySettings.language,
    allowedTypes: resourceTypes.join(", "),
  });
}
