export const maximumGeneratedImageSizes = [1024, 2048, 4096] as const;

export type MaximumGeneratedImageSize =
  (typeof maximumGeneratedImageSizes)[number];

export const defaultMaximumGeneratedImageSize =
  1024 satisfies MaximumGeneratedImageSize;

const maximumTransparentImageSize = 2048 satisfies MaximumGeneratedImageSize;

type ImageGenerationSizeModel = {
  provider: "openai" | "google";
  model: string;
};

type OpenAIImageGenerationSize = {
  provider: "openai";
  requestedMaximumImageSize: MaximumGeneratedImageSize;
  outputImageSize: 1024 | 2048;
  providerImageSize: "1024x1024" | "2048x2048";
};

type GoogleImageGenerationSize = {
  provider: "google";
  requestedMaximumImageSize: MaximumGeneratedImageSize;
  outputImageSize: MaximumGeneratedImageSize;
  providerImageSize?: "1K" | "2K" | "4K";
};

export type ResolvedImageGenerationSize =
  OpenAIImageGenerationSize | GoogleImageGenerationSize;

const isModelOrSnapshot = (model: string, alias: string) =>
  model === alias || model.startsWith(`${alias}-`);

export function resolveImageGenerationSize(options: {
  imageModel: ImageGenerationSizeModel;
  maximumImageSize?: MaximumGeneratedImageSize;
  transparentBackground?: boolean;
}): ResolvedImageGenerationSize {
  const requestedMaximumImageSize =
    options.maximumImageSize ?? defaultMaximumGeneratedImageSize;
  const processingMaximum = options.transparentBackground
    ? Math.min(requestedMaximumImageSize, maximumTransparentImageSize)
    : requestedMaximumImageSize;
  const { provider, model } = options.imageModel;

  if (provider === "openai") {
    const outputImageSize =
      isModelOrSnapshot(model, "gpt-image-2") && processingMaximum >= 2048
        ? 2048
        : 1024;
    return {
      provider,
      requestedMaximumImageSize,
      outputImageSize,
      providerImageSize: outputImageSize === 2048 ? "2048x2048" : "1024x1024",
    };
  }

  if (
    isModelOrSnapshot(model, "gemini-3.1-flash-image") ||
    isModelOrSnapshot(model, "gemini-3-pro-image")
  ) {
    const outputImageSize = processingMaximum as MaximumGeneratedImageSize;
    return {
      provider,
      requestedMaximumImageSize,
      outputImageSize,
      providerImageSize: `${outputImageSize / 1024}K` as "1K" | "2K" | "4K",
    };
  }

  if (isModelOrSnapshot(model, "gemini-3.1-flash-lite-image")) {
    return {
      provider,
      requestedMaximumImageSize,
      outputImageSize: 1024,
      providerImageSize: "1K",
    };
  }

  // Gemini 2.5 Flash Image and unknown Google models are conservatively kept
  // at their default 1K output. Some older models reject imageSize entirely.
  return {
    provider,
    requestedMaximumImageSize,
    outputImageSize: 1024,
  };
}
