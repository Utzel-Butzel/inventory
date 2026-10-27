import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  bulkGeometrySchema,
  bulkCountPrompt,
  bulkStrategies,
  minimumBulkCountImages,
  maximumBulkCountImages,
  maximumBulkCountOutputTokens,
  type BulkGeometry,
  type BulkCountInput,
} from "@/lib/inventory-bulk-count";
import { combineBulkGeometry } from "@/lib/inventory-bulk-geometry";

export async function estimateBulkInventoryItems(options: {
  input: BulkCountInput;
  images: string[];
  model: string;
  idempotencyKey: string;
  onObservations?: (observations: [BulkGeometry, BulkGeometry]) => Promise<void>;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (options.images.length < minimumBulkCountImages || options.images.length > maximumBulkCountImages) {
    throw new Error("Bulk analysis requires 3–5 images.");
  }
  const client = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined });
  const itemObservations = {
    itemHint: options.input.itemHint,
    containerDimensions: options.input.containerDimensions,
    partDimensions: options.input.partDimensions,
  };
  // Neither analysis sees the other's result. Await both even if one fails,
  // so no paid request continues unnoticed after a failed operation returns.
  const responses = await Promise.allSettled(bulkStrategies.map((strategy) => client.responses.parse({
    model: options.model,
    store: false,
    max_output_tokens: maximumBulkCountOutputTokens,
    ...(/^gpt-5\.4(?:-|$)/.test(options.model) ? { reasoning: { effort: "low" as const } } : {}),
    text: { format: zodTextFormat(bulkGeometrySchema, `bulk_geometry_${strategy}`) },
    input: [
      { role: "system", content: bulkCountPrompt(options.input.language, strategy) },
      {
        role: "user",
        content: [
          { type: "input_text", text: JSON.stringify(itemObservations) },
          ...options.images.flatMap((image_url, index) => [
            { type: "input_text" as const, text: `Image ${index + 1}` },
            { type: "input_image" as const, image_url, detail: "high" as const },
          ]),
        ],
      },
    ],
  }, { maxRetries: 0, timeout: 90_000, idempotencyKey: `${options.idempotencyKey}:${strategy}` })));
  const observationsByMethod = responses.map((response) => {
    if (response.status === "rejected") throw response.reason;
    if (!response.value.output_parsed) throw new Error("No structured geometry was returned.");
    return bulkGeometrySchema.parse(response.value.output_parsed);
  });
  const observations: [BulkGeometry, BulkGeometry] = [observationsByMethod[0], observationsByMethod[1]];
  await options.onObservations?.(observations);
  return combineBulkGeometry({
    observations,
    imageCount: options.images.length,
    language: options.input.language,
    model: options.model,
  });
}
