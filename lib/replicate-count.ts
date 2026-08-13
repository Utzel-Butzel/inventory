import "server-only";

import Replicate, { type Prediction } from "replicate";
import sharp from "sharp";

import {
  createInventoryCountResultFromGroundingDino,
  createInventoryCountResultFromSam2,
  createInventoryCountResultFromSam3,
  createInventoryCountResultFromYoloWorld,
  normalizeReplicateCountPrompt,
  replicateSam2OutputSchema,
} from "@/lib/replicate-count-contract";
import {
  resolveInventoryCountModel,
  type InventoryCountModelId,
} from "@/lib/inventory-count-models";
import type { InventoryCountResult } from "@/lib/inventory-count-contract";

const defaultReplicateSam3Model =
  "yodagg/sam3-image-seg:29c8e52db92a11c64f8939244d6b3a047ce2af24412b7971309008b9a61e2f6e";
const defaultReplicateGroundingDinoModel =
  "adirik/grounding-dino:efd10a8ddc57ea28773327e881ce95e20cc1d734c589f7dd01d2036921ed78aa";
const defaultReplicateSam2Model =
  "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83";
const defaultReplicateYoloWorldModel =
  "ultralytics/yolov8s-worldv2:5e89b91b497fa7329dc88dbf820923190236ef7bc5a9b4aa1b7192b206656650";
const defaultPredictionDeadlineSeconds = 300;
const defaultConfidenceThreshold = 0.5;
const defaultMaximumMasks = 100;

const countFailureMessage =
  "The pieces could not be counted reliably. Retake the photo with every item clearly visible and try again.";

export class InventoryCountLocalizationError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;
  readonly ambiguousProviderCreate: boolean;
  readonly predictionTerminal: boolean;

  constructor(
    message = countFailureMessage,
    options: {
      cause?: unknown;
      statusCode?: number;
      retryAfterSeconds?: number;
      ambiguousProviderCreate?: boolean;
      predictionTerminal?: boolean;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "InventoryCountLocalizationError";
    this.statusCode = options.statusCode ?? 502;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.ambiguousProviderCreate = options.ambiguousProviderCreate ?? false;
    this.predictionTerminal = options.predictionTerminal ?? false;
  }
}

export type ReplicateCountJob = {
  predictionId: string;
  countModelId: InventoryCountModelId;
  model: string;
  version: string;
  itemHint?: string;
  prompt: string;
  maxMasks: number;
  imageWidth: number;
  imageHeight: number;
  expiresAt: string;
};

export type ReplicateCountOutcome =
  | {
      kind: "completed";
      result: InventoryCountResult;
      model: string;
    }
  | { kind: "processing"; job: ReplicateCountJob };

class ReplicatePredictionCreateError extends Error {
  constructor(
    message: string,
    readonly response: Response,
  ) {
    super(message);
    this.name = "ReplicatePredictionCreateError";
  }
}

const boundedEnvironmentNumber = (options: {
  name: string;
  fallback: number;
  minimum: number;
  maximum: number;
}) => {
  const raw = process.env[options.name]?.trim();
  if (!raw) return options.fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${options.name} must be a finite number.`);
  }
  return Math.min(options.maximum, Math.max(options.minimum, value));
};

function parseReplicateModelReference(reference: string, environmentName: string) {
  const match = reference.match(
    /^([a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_.-]*):([a-f0-9]{64})$/iu,
  );
  if (!match) {
    throw new Error(
      `${environmentName} must be a pinned owner/model:version reference.`,
    );
  }
  return { model: match[1], version: match[2] };
}

function providerStatus(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    error.response instanceof Response
  ) {
    return error.response.status;
  }
  return undefined;
}

async function maskCentroid(maskUrl: string) {
  const url = new URL(maskUrl);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "replicate.delivery" ||
      url.hostname.endsWith(".replicate.delivery"))
  ) {
    throw new Error("SAM 2 returned an unexpected mask URL.");
  }
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("A SAM 2 mask could not be downloaded.");
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > 12 * 1_024 * 1_024) {
    throw new Error("A SAM 2 mask exceeded the download limit.");
  }
  if (!response.body) throw new Error("A SAM 2 mask had no response body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 12 * 1_024 * 1_024) {
        await reader.cancel();
        throw new Error("A SAM 2 mask exceeded the download limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, total);
  const { data, info } = await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 64_000_000,
  })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let weight = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (value < 128) continue;
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    weight += value;
    weightedX += (x + 0.5) * value;
    weightedY += (y + 0.5) * value;
  }
  if (!weight) throw new Error("SAM 2 returned an empty individual mask.");
  return {
    x: weightedX / weight / info.width,
    y: weightedY / weight / info.height,
  };
}

async function sam2MaskCentroids(output: unknown, maximumMasks: number) {
  const parsed = replicateSam2OutputSchema.parse(output);
  if (parsed.individual_masks.length >= maximumMasks) {
    throw new InventoryCountLocalizationError(
      `The detector reached its limit of ${maximumMasks} pieces. Divide the parts into smaller groups and take another photo.`,
      { statusCode: 422 },
    );
  }
  const centroids: Array<{ x: number; y: number }> = [];
  for (let offset = 0; offset < parsed.individual_masks.length; offset += 8) {
    centroids.push(
      ...(await Promise.all(
        parsed.individual_masks
          .slice(offset, offset + 8)
          .map((maskUrl) => maskCentroid(maskUrl)),
      )),
    );
  }
  return centroids;
}

async function createCountResponse(
  prediction: Prediction,
  context: Omit<ReplicateCountJob, "predictionId" | "expiresAt">,
): Promise<Extract<ReplicateCountOutcome, { kind: "completed" }>> {
  const language = process.env.AI_OUTPUT_LANGUAGE?.trim() || "English";
  let result: InventoryCountResult;
  if (context.countModelId === "grounding-dino") {
    result = createInventoryCountResultFromGroundingDino({
      output: prediction.output,
      itemHint: context.itemHint,
      prompt: context.prompt,
      imageWidth: context.imageWidth,
      imageHeight: context.imageHeight,
      language,
    });
  } else if (context.countModelId === "yolo-world") {
    result = createInventoryCountResultFromYoloWorld({
      output: prediction.output,
      itemHint: context.itemHint,
      prompt: context.prompt,
      imageWidth: context.imageWidth,
      imageHeight: context.imageHeight,
      language,
    });
  } else if (context.countModelId === "sam-2") {
    result = createInventoryCountResultFromSam2({
      centroids: await sam2MaskCentroids(prediction.output, context.maxMasks),
      itemHint: context.itemHint,
      prompt: context.prompt,
      language,
    });
  } else {
    result = createInventoryCountResultFromSam3({
      output: prediction.output,
      itemHint: context.itemHint,
      prompt: context.prompt,
      maxMasks: context.maxMasks,
      language,
    });
  }
  if (context.countModelId === "sam-3" && result.count >= context.maxMasks) {
    throw new InventoryCountLocalizationError(
      `The detector reached its limit of ${context.maxMasks} pieces. Divide the parts into smaller groups and take another photo.`,
      { statusCode: 422 },
    );
  }
  return {
    kind: "completed",
    result,
    model:
      context.countModelId === "grounding-dino"
        ? `Grounding DINO (${context.model}) via Replicate`
        : context.countModelId === "yolo-world"
          ? `YOLO World (${context.model}) via Replicate`
          : context.countModelId === "sam-2"
            ? `SAM 2 (${context.model}) via Replicate`
            : `SAM 3 (${context.model}) via Replicate`,
  };
}

async function predictionOutcome(
  prediction: Prediction,
  job: ReplicateCountJob,
): Promise<ReplicateCountOutcome> {
  if (prediction.id !== job.predictionId || prediction.model !== job.model) {
    throw new InventoryCountLocalizationError(
      "The counting service returned a result for an unexpected prediction.",
    );
  }
  if (prediction.version !== "hidden" && prediction.version !== job.version) {
    throw new InventoryCountLocalizationError(
      "The counting service returned a result from an unexpected model version.",
    );
  }
  const context = {
    countModelId: job.countModelId,
    model: job.model,
    version: job.version,
    itemHint: job.itemHint,
    prompt: job.prompt,
    maxMasks: job.maxMasks,
    imageWidth: job.imageWidth,
    imageHeight: job.imageHeight,
  };
  if (prediction.status === "canceled" || prediction.status === "aborted") {
    throw new InventoryCountLocalizationError(
      "Counting took too long and was stopped. Please try again with a clearer photo.",
      { cause: prediction.error, statusCode: 504, predictionTerminal: true },
    );
  }
  if (prediction.status === "succeeded") {
    try {
      return await createCountResponse(prediction, context);
    } catch (error) {
      if (error instanceof InventoryCountLocalizationError) {
        throw new InventoryCountLocalizationError(error.message, {
          cause: error,
          statusCode: error.statusCode,
          predictionTerminal: true,
        });
      }
      throw new InventoryCountLocalizationError(
        "The counting service returned an invalid result. Please try again.",
        { cause: error, predictionTerminal: true },
      );
    }
  }
  if (
    prediction.output !== undefined &&
    (prediction.status === "starting" || prediction.status === "processing")
  ) {
    try {
      // A file-producing sync prediction may expose its complete structured
      // output while Replicate is still finalizing the unused visualization.
      if (job.countModelId === "sam-2") return { kind: "processing", job };
      return await createCountResponse(prediction, context);
    } catch (error) {
      if (error instanceof InventoryCountLocalizationError) throw error;
      // The output is only partial; keep polling the same prediction.
    }
  }
  if (prediction.status === "starting" || prediction.status === "processing") {
    return { kind: "processing", job };
  }
  throw new InventoryCountLocalizationError(countFailureMessage, {
    cause: prediction.error,
    predictionTerminal: true,
  });
}

export async function countInventoryItemsWithReplicate(options: {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  itemHint?: string;
  modelId?: string;
  signal?: AbortSignal;
}): Promise<ReplicateCountOutcome> {
  const apiToken = process.env.REPLICATE_API_TOKEN?.trim();
  if (!apiToken) {
    throw new InventoryCountLocalizationError(
      "Photo counting is not configured. Add REPLICATE_API_TOKEN on the server.",
      { statusCode: 503 },
    );
  }

  const countModel = resolveInventoryCountModel(options.modelId);
  if (!countModel) {
    throw new InventoryCountLocalizationError(
      "The selected counting model is not available.",
      { statusCode: 422 },
    );
  }
  const modelConfiguration =
    countModel.id === "grounding-dino"
      ? {
          environmentName: "REPLICATE_GROUNDING_DINO_MODEL",
          fallback: defaultReplicateGroundingDinoModel,
        }
      : countModel.id === "yolo-world"
        ? {
            environmentName: "REPLICATE_YOLO_WORLD_MODEL",
            fallback: defaultReplicateYoloWorldModel,
          }
        : countModel.id === "sam-2"
          ? {
              environmentName: "REPLICATE_SAM2_MODEL",
              fallback: defaultReplicateSam2Model,
            }
          : {
              environmentName: "REPLICATE_COUNT_MODEL",
              fallback: defaultReplicateSam3Model,
            };
  const modelEnvironmentName = modelConfiguration.environmentName;
  const modelReference =
    process.env[modelEnvironmentName]?.trim() || modelConfiguration.fallback;
  let parsedModel: ReturnType<typeof parseReplicateModelReference>;
  let predictionDeadlineSeconds: number;
  let confidenceThreshold: number;
  let maxMasks: number;
  try {
    parsedModel = parseReplicateModelReference(
      modelReference,
      modelEnvironmentName,
    );
    predictionDeadlineSeconds = Math.round(
      boundedEnvironmentNumber({
        name: "REPLICATE_COUNT_DEADLINE_SECONDS",
        fallback: defaultPredictionDeadlineSeconds,
        minimum: 30,
        maximum: 600,
      }),
    );
    confidenceThreshold = boundedEnvironmentNumber({
      name: "REPLICATE_COUNT_CONFIDENCE",
      fallback: defaultConfidenceThreshold,
      minimum: 0,
      maximum: 1,
    });
    maxMasks = Math.round(
      boundedEnvironmentNumber({
        name: "REPLICATE_COUNT_MAX_MASKS",
        fallback: defaultMaximumMasks,
        minimum: 1,
        maximum: 100,
      }),
    );
  } catch (error) {
    throw new InventoryCountLocalizationError(
      "Photo counting has an invalid server configuration.",
      { cause: error, statusCode: 503 },
    );
  }

  // Prediction creation should only reserve the job and return its ID. The
  // clients poll that exact ID, avoiding a long start request whose response
  // could be lost while the paid provider job continues in the background.
  const requestTimeout = AbortSignal.timeout(15_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, requestTimeout])
    : requestTimeout;
  const prompt = normalizeReplicateCountPrompt(options.itemHint);
  const prefix = "data:image/jpeg;base64,";
  if (!options.imageDataUrl.startsWith(prefix)) {
    throw new InventoryCountLocalizationError(countFailureMessage);
  }

  let prediction: Prediction;
  try {
    // Do not use the SDK for this POST: replicate@1.4 retries thrown fetch
    // errors, which can duplicate a paid prediction if Replicate accepted the
    // first request but its response was lost. This direct fetch is attempted
    // exactly once; safe automatic retries remain enabled for later GET polls.
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Cancel-After": `${predictionDeadlineSeconds}s`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: parsedModel.version,
        input: (() => {
          if (countModel.id === "grounding-dino") {
            return {
              image: options.imageDataUrl,
              query: prompt,
              box_threshold: Math.min(confidenceThreshold, 0.25),
              text_threshold: Math.min(confidenceThreshold, 0.25),
              show_visualisation: false,
            };
          }
          if (countModel.id === "yolo-world") {
            return {
              image: options.imageDataUrl,
              class_names: prompt,
              conf: Math.min(confidenceThreshold, 0.25),
              iou: 0.45,
              imgsz: 1280,
              return_json: true,
            };
          }
          if (countModel.id === "sam-2") {
            return {
              image: options.imageDataUrl,
              use_m2m: true,
              points_per_side: 32,
              pred_iou_thresh: Math.max(0.5, confidenceThreshold),
              stability_score_thresh: 0.95,
            };
          }
          return {
            // Keep the explicit JPEG MIME type. Passing a bare Buffer through
            // the SDK would label it application/octet-stream.
            image: options.imageDataUrl,
            prompt,
            max_masks: maxMasks,
            confidence_threshold: confidenceThreshold,
            multimask_output: true,
          };
        })(),
      }),
      signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 2_000);
      throw new ReplicatePredictionCreateError(
        `Replicate prediction creation failed (${response.status}): ${details}`,
        response,
      );
    }
    prediction = (await response.json()) as Prediction;
    if (
      !prediction ||
      typeof prediction.id !== "string" ||
      typeof prediction.status !== "string" ||
      typeof prediction.model !== "string" ||
      typeof prediction.version !== "string"
    ) {
      throw new Error("Replicate returned an invalid prediction object.");
    }
  } catch (error) {
    const status = providerStatus(error);
    if (status === 402) {
      throw new InventoryCountLocalizationError(
        "Photo counting is not active because the Replicate account has no billing credit.",
        { cause: error, statusCode: 503 },
      );
    }
    if (status === 401 || status === 403) {
      throw new InventoryCountLocalizationError(
        "Photo counting could not authenticate with Replicate.",
        { cause: error, statusCode: 503 },
      );
    }
    if (status === 429) {
      throw new InventoryCountLocalizationError(
        "The counting service is busy. Please try again shortly.",
        { cause: error, statusCode: 503, retryAfterSeconds: 3 },
      );
    }
    if (signal.aborted) {
      throw new InventoryCountLocalizationError(
        "Replicate may have received this count, but did not return its job ID. For billing safety, wait before retrying this same photo.",
        {
          cause: error,
          statusCode: 409,
          retryAfterSeconds: 30,
          ambiguousProviderCreate: true,
        },
      );
    }
    if (
      !(error instanceof ReplicatePredictionCreateError) ||
      error.response.status === 408 ||
      error.response.status >= 500
    ) {
      // A transport failure or malformed success response can happen after
      // Replicate accepted the POST. Without a prediction ID there is nothing
      // safe to poll, so leave the idempotency claim reserved until the
      // provider's maximum execution window has elapsed.
      throw new InventoryCountLocalizationError(
        "Replicate may have received this count, but did not return its job ID. For billing safety, wait before retrying this same photo.",
        {
          cause: error,
          statusCode: 409,
          retryAfterSeconds: 30,
          ambiguousProviderCreate: true,
        },
      );
    }
    throw new InventoryCountLocalizationError(countFailureMessage, {
      cause: error,
    });
  }

  const job: ReplicateCountJob = {
    predictionId: prediction.id,
    countModelId: countModel.id,
    model: parsedModel.model,
    version: parsedModel.version,
    itemHint: options.itemHint,
    prompt,
    maxMasks,
    imageWidth: options.imageWidth,
    imageHeight: options.imageHeight,
    expiresAt: new Date(
      Date.now() + (predictionDeadlineSeconds + 30) * 1_000,
    ).toISOString(),
  };
  return predictionOutcome(prediction, job);
}

export async function getReplicateCountOutcome(
  job: ReplicateCountJob,
  options: { signal?: AbortSignal } = {},
): Promise<ReplicateCountOutcome> {
  if (Date.parse(job.expiresAt) <= Date.now()) {
    throw new InventoryCountLocalizationError(
      "Counting took too long and expired. Please start a new count.",
      { statusCode: 504 },
    );
  }
  const apiToken = process.env.REPLICATE_API_TOKEN?.trim();
  if (!apiToken) {
    throw new InventoryCountLocalizationError(
      "Photo counting is not configured. Add REPLICATE_API_TOKEN on the server.",
      { statusCode: 503 },
    );
  }
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);
  try {
    const replicate = new Replicate({
      auth: apiToken,
      useFileOutput: false,
    });
    const prediction = await replicate.predictions.get(job.predictionId, {
      signal,
    });
    return predictionOutcome(prediction, job);
  } catch (error) {
    if (error instanceof InventoryCountLocalizationError) throw error;
    const status = providerStatus(error);
    if (status === 401 || status === 403) {
      throw new InventoryCountLocalizationError(
        "Photo counting could not authenticate with Replicate.",
        { cause: error, statusCode: 503 },
      );
    }
    if (status === 429 || signal.aborted) {
      throw new InventoryCountLocalizationError(
        "The counting service is busy. Please try again shortly.",
        { cause: error, statusCode: 503, retryAfterSeconds: 3 },
      );
    }
    throw new InventoryCountLocalizationError(countFailureMessage, {
      cause: error,
    });
  }
}
