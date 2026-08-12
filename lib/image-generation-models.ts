import "server-only";

export const imageGenerationProviders = ["openai", "google"] as const;

export type ImageGenerationProvider =
  (typeof imageGenerationProviders)[number];

export type ImageGenerationModel = {
  id: string;
  provider: ImageGenerationProvider;
  model: string;
  label: string;
};

export type ImageGenerationModelCatalog = {
  models: ImageGenerationModel[];
  defaultModelId: string | null;
};

const friendlyModelLabels: Record<string, string> = {
  "openai:gpt-image-2": "GPT Image 2",
  "openai:gpt-image-1.5": "GPT Image 1.5",
  "openai:gpt-image-1": "GPT Image 1",
  "openai:gpt-image-1-mini": "GPT Image 1 Mini",
  "google:gemini-3.1-flash-lite-image": "Nano Banana 2 Lite",
  "google:gemini-3.1-flash-image": "Nano Banana 2",
  "google:gemini-3-pro-image": "Nano Banana Pro",
  "google:gemini-2.5-flash-image": "Nano Banana",
};

const isImageGenerationProvider = (
  value: string,
): value is ImageGenerationProvider =>
  (imageGenerationProviders as readonly string[]).includes(value);

const modelOption = (
  provider: ImageGenerationProvider,
  model: string,
): ImageGenerationModel => {
  const id = `${provider}:${model}`;
  return {
    id,
    provider,
    model,
    label:
      friendlyModelLabels[id] ??
      `${model} (${provider === "openai" ? "OpenAI" : "Google"})`,
  };
};

const parseModelPair = (value: string): ImageGenerationModel | null => {
  const separator = value.indexOf(":");
  if (separator < 1) return null;

  const provider = value.slice(0, separator).trim().toLowerCase();
  const model = value.slice(separator + 1).trim();
  if (!isImageGenerationProvider(provider) || !model || model.length > 233) {
    return null;
  }
  return modelOption(provider, model);
};

const legacyModel = (): ImageGenerationModel | null => {
  const configuredProvider = (process.env.IMAGE_EDIT_PROVIDER ?? "openai")
    .trim()
    .toLowerCase();
  const provider: ImageGenerationProvider =
    configuredProvider === "google" ? "google" : "openai";
  const model =
    provider === "google"
      ? process.env.GOOGLE_IMAGE_EDIT_MODEL?.trim() ||
        "gemini-2.5-flash-image"
      : process.env.OPENAI_IMAGE_EDIT_MODEL?.trim() || "gpt-image-1";
  if (model.length > 233) return null;
  return modelOption(provider, model);
};

const configuredModels = (): ImageGenerationModel[] => {
  const configured = process.env.IMAGE_EDIT_MODELS?.trim();
  if (!configured) {
    const model = legacyModel();
    return model ? [model] : [];
  }

  const seen = new Set<string>();
  const models: ImageGenerationModel[] = [];
  for (const value of configured.split(",")) {
    const option = parseModelPair(value.trim());
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    models.push(option);
  }
  return models;
};

const configuredDefaultModel = (
  models: ImageGenerationModel[],
): ImageGenerationModel | null => {
  const configuredDefault = process.env.IMAGE_EDIT_DEFAULT_MODEL?.trim();
  if (configuredDefault) {
    const normalizedDefault =
      parseModelPair(configuredDefault)?.id ?? configuredDefault;
    const selected = models.find((model) => model.id === normalizedDefault);
    if (selected) return selected;
  }
  return models[0] ?? null;
};

export const getConfiguredDefaultImageGenerationModel =
  (): ImageGenerationModel | null => configuredDefaultModel(configuredModels());

export const getImageGenerationProviderReadiness = (): Record<
  ImageGenerationProvider,
  boolean
> => ({
  openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
  google: Boolean(
    process.env.GOOGLE_AI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim(),
  ),
});

export const getImageGenerationModelCatalog =
  (): ImageGenerationModelCatalog => {
    const models = configuredModels();
    const readiness = getImageGenerationProviderReadiness();
    const availableModels = models.filter(
      (model) => readiness[model.provider],
    );
    const preferredDefault = configuredDefaultModel(models);
    const defaultModel =
      availableModels.find((model) => model.id === preferredDefault?.id) ??
      availableModels[0] ??
      null;

    return {
      models: availableModels,
      defaultModelId: defaultModel?.id ?? null,
    };
  };

export const resolveImageGenerationModel = (
  requestedModelId?: string,
): ImageGenerationModel | null => {
  const models = configuredModels();
  const readiness = getImageGenerationProviderReadiness();

  if (requestedModelId) {
    const normalizedModelId =
      parseModelPair(requestedModelId)?.id ?? requestedModelId;
    return (
      models.find(
        (model) =>
          model.id === normalizedModelId && readiness[model.provider],
      ) ?? null
    );
  }

  const catalog = getImageGenerationModelCatalog();
  if (!catalog.defaultModelId) return null;
  return (
    models.find((model) => model.id === catalog.defaultModelId) ?? null
  );
};
