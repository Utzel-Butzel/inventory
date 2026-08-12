import "server-only";

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import sharp from "sharp";
import { z } from "zod";

import { resourceTypes, type ResourceType } from "@/db/schema";
import type { ImageGenerationModel } from "@/lib/image-generation-models";
import {
  countInventoryItemsWithReplicate,
} from "@/lib/replicate-count";
export {
  getReplicateCountOutcome,
  InventoryCountLocalizationError,
} from "@/lib/replicate-count";
export type {
  ReplicateCountJob,
  ReplicateCountOutcome,
} from "@/lib/replicate-count";
export { defaultCoverPrompt } from "@/lib/ai-prompts";

const analysisResultSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(20_000),
  tags: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  type: z.enum(resourceTypes),
  altText: z.string().trim().min(1).max(500),
  confidence: z.number().min(0).max(1),
});

export type InventoryAnalysis = z.infer<typeof analysisResultSchema>;

export type { InventoryCountResult } from "@/lib/inventory-count-contract";

const maximumCountInputPixels = 64_000_000;
// Keep the JPEG comfortably inside Replicate's inline data-URI limit even for
// high-detail circuit boards. This avoids a separate provider file upload and
// leaves prediction creation as the only potentially billable POST.
const maximumCountImageDimension = 1_600;
const maximumCountJpegBytes = 7_250_000;

const createOpenAI = () => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
  });
};

export async function analyzeInventoryImages(dataUrls: string[]) {
  if (!dataUrls.length) throw new Error("Add at least one image first.");
  const language = process.env.AI_OUTPUT_LANGUAGE?.trim() || "English";
  const model = process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4.1-mini";
  const openai = createOpenAI();

  const response = await openai.responses.create({
    model,
    text: {
      format: {
        type: "json_schema",
        name: "inventory_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            type: { type: "string", enum: [...resourceTypes] },
            altText: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: [
            "title",
            "description",
            "tags",
            "type",
            "altText",
            "confidence",
          ],
        },
      },
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `You are cataloguing an inventory item from one or more photos.

Identify the dominant item and ignore background clutter. Write in ${language}.
- Create a concise, specific title.
- Write a useful inventory description with short bullet lines covering category, brand, model, material, color, visible condition, accessories and readable labels.
- Never invent facts. Say "unknown" when a detail is not reliably visible.
- Return 5–12 short lowercase tags without #.
- Classify it as exactly one of: ${resourceTypes.join(", ")}.
- Write accessible alt text describing what is visibly shown.
- Give a confidence score between 0 and 1.

Return only the requested JSON object.`,
          },
          ...dataUrls.slice(0, 3).map((imageUrl) => ({
            type: "input_image" as const,
            image_url: imageUrl,
            detail: "auto" as const,
          })),
        ],
      },
    ],
  });

  if (!response.output_text?.trim()) {
    throw new Error("The AI analysis returned an empty response.");
  }
  return {
    result: analysisResultSchema.parse(JSON.parse(response.output_text)),
    model,
  };
}

/**
 * Decode untrusted camera input and convert it to a bounded format supported by
 * the vision API. This deliberately runs before the provider request so a MIME
 * label alone is never treated as proof that the upload is an image.
 */
export async function prepareInventoryCountImage(source: Buffer) {
  if (!source.length) throw new Error("The image is empty.");

  const image = sharp(source, {
    failOnError: true,
    limitInputPixels: maximumCountInputPixels,
  });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("The image dimensions could not be read.");
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw new Error("Animated or multi-page images are not supported.");
  }

  const normalized = await image
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: maximumCountImageDimension,
      height: maximumCountImageDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  if (normalized.length > maximumCountJpegBytes) {
    throw new Error("The normalized count image is too large for the provider.");
  }

  const normalizedMetadata = await sharp(normalized).metadata();
  if (!normalizedMetadata.width || !normalizedMetadata.height) {
    throw new Error("The normalized count image dimensions could not be read.");
  }
  return {
    dataUrl: `data:image/jpeg;base64,${normalized.toString("base64")}`,
    width: normalizedMetadata.width,
    height: normalizedMetadata.height,
  };
}

export async function countInventoryItems(options: {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  itemHint?: string;
  modelId?: string;
  signal?: AbortSignal;
}) {
  return countInventoryItemsWithReplicate(options);
}

export async function generateCoverImage(options: {
  source: Buffer;
  sourceMimeType: string;
  prompt: string;
  imageModel: ImageGenerationModel;
}) {
  const normalized = await sharp(options.source, { failOnError: false })
    .rotate()
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const { id, provider, model, label } = options.imageModel;
  let generatedBytes: Buffer;

  if (provider === "google") {
    const apiKey =
      process.env.GOOGLE_AI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim();
    if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not configured.");
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model,
      config: { imageConfig: { aspectRatio: "1:1" } },
      contents: [
        {
          inlineData: {
            data: normalized.toString("base64"),
            mimeType: "image/png",
          },
        },
        {
          text: `${options.prompt}\n\nReturn exactly one square 1024×1024 image.`,
        },
      ],
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (part) => part.thought !== true && Boolean(part.inlineData?.data),
    );
    if (!imagePart?.inlineData?.data) {
      throw new Error("Google image generation did not return an image.");
    }
    generatedBytes = Buffer.from(imagePart.inlineData.data, "base64");
  } else {
    const openai = createOpenAI();
    const image = await toFile(normalized, "inventory-source.png", {
      type: "image/png",
    });
    const response = await openai.images.edit({
      model,
      image,
      prompt: options.prompt,
      size: "1024x1024",
      quality: "high",
      background: "opaque",
    });
    const base64 = response.data?.[0]?.b64_json;
    if (!base64) throw new Error("OpenAI image generation did not return an image.");
    generatedBytes = Buffer.from(base64, "base64");
  }

  const jpeg = await sharp(generatedBytes, { failOnError: false })
    .resize({ width: 1024, height: 1024, fit: "cover" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return {
    bytes: jpeg,
    mimeType: "image/jpeg",
    id,
    provider,
    model,
    label,
  };
}

export function isResourceType(value: string): value is ResourceType {
  return (resourceTypes as readonly string[]).includes(value);
}
