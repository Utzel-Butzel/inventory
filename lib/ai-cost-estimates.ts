export const aiCostOperationIds = [
  "inventoryAnalysis",
  "inventoryResearch",
  "imageSearch",
  "inventoryRecognition",
  "translation",
  "roomAnalysis",
  "workflowExtraction",
] as const;

export type AiCostOperationId = (typeof aiCostOperationIds)[number];

export type AiCostEstimate = {
  provider: "openai" | "google";
  model: string;
  minimumUsd: number;
  maximumUsd: number;
  unit: "action" | "itemLanguage" | "imagePass";
};

export type AiCostEstimateCatalog = {
  currency: "USD";
  pricingUpdatedAt: string;
  operations: Partial<Record<AiCostOperationId, AiCostEstimate>>;
};

type TextTokenRates = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

type TokenAssumption = {
  input: number;
  output: number;
  fixedUsd?: number;
};

const pricingUpdatedAt = "2026-08-21";

const modelMatches = (model: string, alias: string) =>
  model === alias || model.startsWith(`${alias}-`);

const openAiTextRates = (model: string): TextTokenRates | null => {
  const rates: Array<[string, TextTokenRates]> = [
    ["gpt-5.6-terra", { inputUsdPerMillion: 2, outputUsdPerMillion: 12 }],
    ["gpt-5.6-luna", { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 }],
    ["gpt-5.6-sol", { inputUsdPerMillion: 5, outputUsdPerMillion: 30 }],
    ["gpt-5.5", { inputUsdPerMillion: 5, outputUsdPerMillion: 30 }],
    ["gpt-5.4-mini", { inputUsdPerMillion: 0.75, outputUsdPerMillion: 4.5 }],
    ["gpt-5.4", { inputUsdPerMillion: 2.5, outputUsdPerMillion: 15 }],
    ["gpt-4.1-mini", { inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 }],
    ["gpt-4.1-nano", { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 }],
    ["gpt-4.1", { inputUsdPerMillion: 2, outputUsdPerMillion: 8 }],
  ];
  return rates.find(([alias]) => modelMatches(model, alias))?.[1] ?? null;
};

const roundedUsd = (value: number) => Number(value.toFixed(6));

const tokenCost = (rates: TextTokenRates, assumption: TokenAssumption) =>
  roundedUsd(
    (assumption.input * rates.inputUsdPerMillion +
      assumption.output * rates.outputUsdPerMillion) /
      1_000_000 +
      (assumption.fixedUsd ?? 0),
  );

const openAiOperationEstimate = (options: {
  model: string;
  minimum: TokenAssumption;
  maximum: TokenAssumption;
  unit?: AiCostEstimate["unit"];
}): AiCostEstimate | undefined => {
  const rates = openAiTextRates(options.model);
  if (!rates) return undefined;
  return {
    provider: "openai",
    model: options.model,
    minimumUsd: tokenCost(rates, options.minimum),
    maximumUsd: tokenCost(rates, options.maximum),
    unit: options.unit ?? "action",
  };
};

/**
 * Standard API price estimate for one high-quality square 1K image request.
 * The range includes the generated output and, at the upper bound, the small
 * prompt/reference-image input charge used by cover edits.
 */
export const imageGenerationCostEstimate = (
  provider: "openai" | "google",
  model: string,
): Pick<AiCostEstimate, "minimumUsd" | "maximumUsd" | "unit"> | undefined => {
  const known: Array<
    ["openai" | "google", string, number, number]
  > = [
    ["openai", "gpt-image-2", 0.125, 0.14],
    ["openai", "gpt-image-1.5", 0.133, 0.15],
    ["openai", "gpt-image-1-mini", 0.036, 0.04],
    ["openai", "gpt-image-1", 0.167, 0.19],
    ["google", "gemini-3.1-flash-lite-image", 0.0336, 0.035],
    ["google", "gemini-3.1-flash-image", 0.067, 0.069],
    ["google", "gemini-3-pro-image", 0.134, 0.136],
    ["google", "gemini-2.5-flash-image", 0.039, 0.041],
  ];
  const match = known.find(
    ([candidateProvider, alias]) =>
      candidateProvider === provider && modelMatches(model, alias),
  );
  if (!match) return undefined;
  return {
    minimumUsd: match[2],
    maximumUsd: match[3],
    unit: "imagePass",
  };
};

export const imageGenerationCostEstimatesBySize = (
  provider: "openai" | "google",
  model: string,
) => {
  const oneK = imageGenerationCostEstimate(provider, model);
  if (!oneK) return undefined;
  const estimates: Record<string, typeof oneK> = {
    "1024": oneK,
    "2048": oneK,
    "4096": oneK,
  };
  if (provider === "openai" && modelMatches(model, "gpt-image-2")) {
    const twoK = {
      minimumUsd: 0.5,
      maximumUsd: 0.56,
      unit: "imagePass" as const,
    };
    estimates["2048"] = twoK;
    // The app caps GPT Image 2 at its supported 2K square output.
    estimates["4096"] = twoK;
  } else if (
    provider === "google" &&
    modelMatches(model, "gemini-3.1-flash-image")
  ) {
    estimates["2048"] = {
      minimumUsd: 0.101,
      maximumUsd: 0.103,
      unit: "imagePass",
    };
    estimates["4096"] = {
      minimumUsd: 0.151,
      maximumUsd: 0.154,
      unit: "imagePass",
    };
  } else if (
    provider === "google" &&
    modelMatches(model, "gemini-3-pro-image")
  ) {
    estimates["4096"] = {
      minimumUsd: 0.24,
      maximumUsd: 0.243,
      unit: "imagePass",
    };
  }
  return estimates;
};

export const getAiCostEstimateCatalog = (
  environment: Record<string, string | undefined> = process.env,
): AiCostEstimateCatalog => {
  const visionModel =
    environment.OPENAI_VISION_MODEL?.trim() || "gpt-4.1-mini";
  const researchModel =
    environment.OPENAI_RESEARCH_MODEL?.trim() || "gpt-5.6-terra";
  const translationModel =
    environment.OPENAI_TRANSLATION_MODEL?.trim() || "gpt-5.6-terra";
  const roomModel =
    environment.OPENAI_ROOM_VISION_MODEL?.trim() ||
    "gpt-5.6-terra";
  const workflowExtractionModel =
    environment.OPENAI_SCAN_EXTRACTION_MODEL?.trim() || "gpt-5.6-luna";

  const operations: AiCostEstimateCatalog["operations"] = {};
  const add = (
    operation: AiCostOperationId,
    estimate: AiCostEstimate | undefined,
  ) => {
    if (estimate) operations[operation] = estimate;
  };

  add(
    "inventoryAnalysis",
    openAiOperationEstimate({
      model: visionModel,
      minimum: { input: 2_000, output: 350 },
      maximum: { input: 7_000, output: 1_800 },
    }),
  );
  add(
    "inventoryResearch",
    openAiOperationEstimate({
      model: researchModel,
      minimum: { input: 4_000, output: 1_000, fixedUsd: 0.01 },
      maximum: { input: 18_000, output: 4_000, fixedUsd: 0.01 },
    }),
  );
  add(
    "imageSearch",
    openAiOperationEstimate({
      model: researchModel,
      minimum: { input: 1_000, output: 300, fixedUsd: 0.01 },
      maximum: { input: 4_000, output: 1_200, fixedUsd: 0.01 },
    }),
  );
  add(
    "inventoryRecognition",
    openAiOperationEstimate({
      model: visionModel,
      minimum: { input: 5_000, output: 900 },
      maximum: { input: 25_000, output: 2_500 },
    }),
  );
  add(
    "translation",
    openAiOperationEstimate({
      model: translationModel,
      minimum: { input: 1_500, output: 500 },
      maximum: { input: 8_000, output: 5_000 },
      unit: "itemLanguage",
    }),
  );
  add(
    "roomAnalysis",
    openAiOperationEstimate({
      model: roomModel,
      // Focused visual passes, optional low-recall audits, and consolidation.
      minimum: { input: 12_000, output: 10_000 },
      maximum: { input: 240_000, output: 96_000 },
    }),
  );
  add(
    "workflowExtraction",
    openAiOperationEstimate({
      model: workflowExtractionModel,
      minimum: { input: 600, output: 120 },
      maximum: { input: 2_500, output: 600 },
    }),
  );

  return {
    currency: "USD",
    pricingUpdatedAt,
    operations,
  };
};
