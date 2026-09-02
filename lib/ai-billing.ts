import {
  getAiCostEstimateCatalog,
  imageGenerationCostEstimatesBySize,
} from "@/lib/ai-cost-estimates";
import type { InventoryCountModelId } from "@/lib/inventory-count-models";

export const aiBillableActions = [
  "inventory_analysis",
  "inventory_research",
  "image_search",
  "inventory_recognition",
  "photo_count",
  "image_generation",
  "translation",
  "room_analysis",
  "workflow_extraction",
] as const;

export type AiBillableAction = (typeof aiBillableActions)[number];
export type AiUsageProvider = "openai" | "google" | "replicate";

export const aiActionPermissions = {
  inventory_analysis: "ai.analyze",
  inventory_research: "ai.research",
  image_search: "ai.research",
  inventory_recognition: "ai.recognize",
  photo_count: "ai.count",
  image_generation: "ai.images",
  translation: "ai.translate",
  room_analysis: "ai.rooms",
  workflow_extraction: "ai.analyze",
} as const;

export type AiUsageEstimate = {
  action: AiBillableAction;
  provider: AiUsageProvider;
  model: string;
  costMicros: number;
  estimated: true;
};

const usdToMicros = (usd: number) => Math.max(0, Math.round(usd * 1_000_000));

const catalogOperationForAction = {
  inventory_analysis: "inventoryAnalysis",
  inventory_research: "inventoryResearch",
  image_search: "imageSearch",
  inventory_recognition: "inventoryRecognition",
  translation: "translation",
  room_analysis: "roomAnalysis",
  workflow_extraction: "workflowExtraction",
} as const;

const countMaximumUsd: Record<InventoryCountModelId, number> = {
  "grounding-dino": 0.02,
  "yolo-world": 0.02,
  "sam-2": 0.05,
  "sam-3": 0.08,
};

export function aiUsageEstimate(options: {
  action: Exclude<AiBillableAction, "photo_count" | "image_generation">;
  environment?: Record<string, string | undefined>;
}): AiUsageEstimate;
export function aiUsageEstimate(options: {
  action: "photo_count";
  modelId: InventoryCountModelId;
  model: string;
}): AiUsageEstimate;
export function aiUsageEstimate(options: {
  action: "image_generation";
  provider: "openai" | "google";
  model: string;
  maximumImageSize?: 1024 | 2048 | 4096;
  quantity?: number;
}): AiUsageEstimate;
export function aiUsageEstimate(options: {
  action: AiBillableAction;
  environment?: Record<string, string | undefined>;
  modelId?: InventoryCountModelId;
  provider?: "openai" | "google";
  model?: string;
  maximumImageSize?: 1024 | 2048 | 4096;
  quantity?: number;
}): AiUsageEstimate {
  if (options.action === "photo_count") {
    const modelId = options.modelId ?? "grounding-dino";
    return {
      action: options.action,
      provider: "replicate",
      model: options.model ?? modelId,
      costMicros: usdToMicros(countMaximumUsd[modelId]),
      estimated: true,
    };
  }
  if (options.action === "image_generation") {
    const provider = options.provider ?? "openai";
    const model = options.model ?? "unknown";
    const estimate = imageGenerationCostEstimatesBySize(provider, model)?.[
      String(options.maximumImageSize ?? 1024)
    ];
    return {
      action: options.action,
      provider,
      model,
      costMicros:
        usdToMicros(estimate?.maximumUsd ?? 1) *
        Math.max(1, Math.floor(options.quantity ?? 1)),
      estimated: true,
    };
  }
  const operation = catalogOperationForAction[options.action];
  const estimate = getAiCostEstimateCatalog(options.environment).operations[
    operation
  ];
  return {
    action: options.action,
    provider: estimate?.provider ?? "openai",
    model: estimate?.model ?? "unpriced-model",
    // Unknown custom endpoints are deliberately reserved conservatively. The
    // deployment can use a known model alias when exact budget behavior matters.
    costMicros: usdToMicros(estimate?.maximumUsd ?? 1),
    estimated: true,
  };
}
