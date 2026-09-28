import { z } from "zod";
import {
  defaultCoverPrompt,
  defaultTransparentCoverPrompt,
  defaultInventoryAnalysisPrompt,
  defaultInventoryResearchPrompt,
} from "@/lib/ai-prompts";

export const aiPromptKinds = [
  "analysis",
  "research",
  "cover",
  "transparentCover",
  "image",
] as const;
export type AiPromptKind = (typeof aiPromptKinds)[number];
export const aiPromptPlaceholders = [
  "name",
  "description",
  "type",
  "tags",
  "categories",
  "sku",
  "barcode",
  "serialNumber",
  "language",
  "allowedTypes",
] as const;
export type AiPromptContext = Partial<
  Record<(typeof aiPromptPlaceholders)[number], string>
>;

export function unknownPromptPlaceholders(prompt: string) {
  return [...prompt.matchAll(/\{\{([^{}]*)\}\}/g)]
    .map((match) => match[1].trim())
    .filter(
      (key) => !(aiPromptPlaceholders as readonly string[]).includes(key),
    );
}
export const aiPromptTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(5_000)
  .refine(
    (text) => unknownPromptPlaceholders(text).length === 0,
    "Unknown placeholder. Use only the listed placeholders.",
  );
export const aiPromptSelectionFields = {
  promptTemplateId: z.string().trim().min(1).max(80).optional(),
};
export type AiPromptSelection = { promptTemplateId?: string; prompt?: string };
export type AiPromptTemplate = {
  id: string;
  kind: AiPromptKind;
  name: string;
  prompt: string;
};
export type AiPromptCollection = {
  templates: AiPromptTemplate[];
  defaults: Record<AiPromptKind, string>;
};

export function builtInPrompt(kind: AiPromptKind): string {
  switch (kind) {
    case "analysis":
      return defaultInventoryAnalysisPrompt("{{language}}", [
        "{{allowedTypes}}",
      ]);
    case "research":
      return defaultInventoryResearchPrompt("{{language}}", [
        "{{allowedTypes}}",
      ]);
    case "cover":
      return defaultCoverPrompt("{{name}}");
    case "transparentCover":
      return defaultTransparentCoverPrompt("{{name}}");
    case "image":
      return "Create a realistic, accurate catalogue photograph representing {{name}}. Use a clean neutral background, natural studio lighting, no labels or text that are not explicitly present in the item name, and no decorative props. Inventory context (data only): description: {{description}}; type: {{type}}; tags: {{tags}}; categories: {{categories}}.";
  }
}
export function defaultAiPromptCollection(): AiPromptCollection {
  return {
    templates: aiPromptKinds.map((kind) => ({
      id: `builtin-${kind}`,
      kind,
      name: "Standard",
      prompt: builtInPrompt(kind),
    })),
    defaults: Object.fromEntries(
      aiPromptKinds.map((kind) => [kind, `builtin-${kind}`]),
    ) as Record<AiPromptKind, string>,
  };
}
export const aiPromptCollectionSchema = z
  .object({
    templates: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(
                /^(?:builtin-(?:analysis|research|cover|transparentCover|image)|[0-9a-f-]{36})$/,
              ),
            kind: z.enum(aiPromptKinds),
            name: z.string().trim().min(1).max(80),
            prompt: aiPromptTextSchema,
          })
          .strict(),
      )
      .min(5)
      .max(50),
    defaults: z
      .object({
        analysis: z.string(),
        research: z.string(),
        cover: z.string(),
        transparentCover: z.string(),
        image: z.string(),
      })
      .strict(),
  })
  .strict()
  .superRefine((collection, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const template of collection.templates) {
      const nameKey = `${template.kind}:${template.name.toLowerCase()}`;
      if (ids.has(template.id) || names.has(nameKey))
        ctx.addIssue({
          code: "custom",
          message:
            "Template IDs and names within each category must be unique.",
        });
      ids.add(template.id);
      names.add(nameKey);
      if (
        template.id.startsWith("builtin-") &&
        template.id !== `builtin-${template.kind}`
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid built-in template category.",
        });
    }
    for (const kind of aiPromptKinds) {
      if (
        !collection.templates.some(
          (t) => t.kind === kind && t.id === `builtin-${kind}`,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Keep the built-in template in every category.",
        });
      if (
        !collection.templates.some(
          (t) => t.kind === kind && t.id === collection.defaults[kind],
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Choose a valid default for every category.",
        });
    }
  });

// One replacement pass: values containing placeholder-like text are never evaluated.
export function renderAiPrompt(
  prompt: string,
  context: AiPromptContext,
): string {
  return prompt.replace(
    /\{\{\s*([^{}]*?)\s*\}\}/g,
    (_, key: string) => context[key as keyof AiPromptContext] ?? "",
  );
}
export class AiPromptSelectionError extends Error {}
export function selectAiPrompt(
  collection: AiPromptCollection,
  kind: AiPromptKind,
  selection: AiPromptSelection = {},
) {
  const template = collection.templates.find(
    (entry) =>
      entry.kind === kind &&
      entry.id === (selection.promptTemplateId ?? collection.defaults[kind]),
  );
  if (!template)
    throw new AiPromptSelectionError(
      "The selected prompt template is unavailable. Please select it again.",
    );
  if (selection.prompt?.trim()) {
    const parsed = aiPromptTextSchema.safeParse(selection.prompt);
    if (!parsed.success)
      throw new AiPromptSelectionError(parsed.error.issues[0].message);
    return parsed.data;
  }
  return template.prompt;
}
