import { z } from "zod";

export const inventoryAiSettingsSchema = z.object({
  analysisModel: z.string().trim().min(1).max(200),
  researchModel: z.string().trim().min(1).max(200),
  language: z.string().trim().min(1).max(100),
  maximumImages: z.number().int().min(1).max(3),
  autoAnalyze: z.boolean(),
  autoResearch: z.boolean(),
  overwrite: z.boolean(),
}).strict();
export type InventoryAiSettings = z.infer<typeof inventoryAiSettingsSchema>;

export function defaultInventoryAiSettings(environment: Record<string, string | undefined> = {}): InventoryAiSettings {
  return {
    analysisModel: environment.OPENAI_VISION_MODEL?.trim() || "gpt-4.1-mini",
    researchModel: environment.OPENAI_RESEARCH_MODEL?.trim() || "gpt-5.6-terra",
    language: environment.AI_OUTPUT_LANGUAGE?.trim() || "English",
    maximumImages: 3,
    autoAnalyze: true,
    autoResearch: false,
    overwrite: true,
  };
}

export function inventoryAiEnvironment(settings: InventoryAiSettings) {
  return { OPENAI_VISION_MODEL: settings.analysisModel, OPENAI_RESEARCH_MODEL: settings.researchModel };
}
