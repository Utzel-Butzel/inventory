import "server-only";

import Replicate, { type Prediction } from "replicate";

import {
  createInventoryCountResultFromSam3,
  normalizeReplicateCountPrompt,
} from "@/lib/replicate-count-contract";

const defaultReplicateCountModel =
  "yodagg/sam3-image-seg:29c8e52db92a11c64f8939244d6b3a047ce2af24412b7971309008b9a61e2f6e";
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
  model: string;
  version: string;
  itemHint?: string;
  prompt: string;
  maxMasks: number;
  expiresAt: string;
};

export type ReplicateCountOutcome =
  | {
      kind: "completed";
      result: ReturnType<typeof createInventoryCountResultFromSam3>;
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

function parseReplicateModelReference(reference: string) {
  const match = reference.match(
    /^([a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_.-]*):([a-f0-9]{64})$/iu,
  );
  if (!match) {
    throw new Error(
      "REPLICATE_COUNT_MODEL must be a pinned owner/model:version reference.",
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

function createCountResponse(
  prediction: Prediction,
  context: Omit<ReplicateCountJob, "predictionId" | "expiresAt">,
): Extract<ReplicateCountOutcome, { kind: "completed" }> {
  const language = process.env.AI_OUTPUT_LANGUAGE?.trim() || "English";
  const result = createInventoryCountResultFromSam3({
    output: prediction.output,
    itemHint: context.itemHint,
    prompt: context.prompt,
    maxMasks: context.maxMasks,
    language,
  });
  if (result.count >= context.maxMasks) {
    throw new InventoryCountLocalizationError(
      `The detector reached its limit of ${context.maxMasks} pieces. Divide the parts into smaller groups and take another photo.`,
      { statusCode: 422 },
    );
  }
  return {
    kind: "completed",
    result,
    model: `SAM 3 (${context.model}) via Replicate`,
  };
}

function predictionOutcome(
  prediction: Prediction,
  job: ReplicateCountJob,
): ReplicateCountOutcome {
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
    model: job.model,
    version: job.version,
    itemHint: job.itemHint,
    prompt: job.prompt,
    maxMasks: job.maxMasks,
  };
  if (prediction.status === "canceled" || prediction.status === "aborted") {
    throw new InventoryCountLocalizationError(
      "Counting took too long and was stopped. Please try again with a clearer photo.",
      { cause: prediction.error, statusCode: 504, predictionTerminal: true },
    );
  }
  if (prediction.status === "succeeded") {
    try {
      return createCountResponse(prediction, context);
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
      return createCountResponse(prediction, context);
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
  itemHint?: string;
  signal?: AbortSignal;
}): Promise<ReplicateCountOutcome> {
  const apiToken = process.env.REPLICATE_API_TOKEN?.trim();
  if (!apiToken) {
    throw new InventoryCountLocalizationError(
      "Photo counting is not configured. Add REPLICATE_API_TOKEN on the server.",
      { statusCode: 503 },
    );
  }

  const modelReference =
    process.env.REPLICATE_COUNT_MODEL?.trim() || defaultReplicateCountModel;
  let parsedModel: ReturnType<typeof parseReplicateModelReference>;
  let predictionDeadlineSeconds: number;
  let confidenceThreshold: number;
  let maxMasks: number;
  try {
    parsedModel = parseReplicateModelReference(modelReference);
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
        input: {
        // Keep the explicit JPEG MIME type. Passing a bare Buffer through the
        // SDK's data-URI encoder would label it application/octet-stream.
          image: options.imageDataUrl,
          prompt,
          max_masks: maxMasks,
          confidence_threshold: confidenceThreshold,
          multimask_output: true,
        },
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
    model: parsedModel.model,
    version: parsedModel.version,
    itemHint: options.itemHint,
    prompt,
    maxMasks,
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
