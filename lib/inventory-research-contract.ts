import { z } from "zod";

import { resourceTypes } from "@/db/schema";

export const inventoryResearchResultSchema = z
  .object({
    title: z.string().trim().max(240),
    additionalDescription: z.string().trim().max(12_000),
    type: z.enum(resourceTypes),
    tags: z.array(z.string().trim().min(1).max(60)).max(20),
    categories: z.array(z.string().trim().min(1).max(120)).max(12),
    sku: z.string().trim().max(80),
    serialNumber: z.string().trim().max(180),
    barcode: z.string().trim().max(180),
    valueCents: z.number().int().min(0).max(2_000_000_000).nullable(),
    currency: z.union([z.literal(""), z.string().trim().length(3).toUpperCase()]),
    internalNotes: z.string().trim().max(8_000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type InventoryResearchResult = z.infer<
  typeof inventoryResearchResultSchema
>;

export type InventoryResearchResource = {
  name: string;
  description: string;
  type: string;
  tags: string[];
  categories: Array<{ name: string; color?: string }>;
  sku: string | null;
  serialNumber: string | null;
  barcode: string | null;
  valueCents: number | null;
  currency: string;
  notes: string;
};

export type InventoryResearchValues = Partial<InventoryResearchResource>;

const genericTitles = new Set([
  "untitled",
  "untitled item",
  "unbenannt",
  "unbenannter eintrag",
]);

const isGenericTitle = (title: string) =>
  !title.trim() || genericTitles.has(title.trim().toLocaleLowerCase());

const mergeUniqueStrings = (
  current: string[],
  additions: string[],
  maximum: number,
) => {
  const seen = new Set(current.map((value) => value.toLocaleLowerCase()));
  const merged = [...current];
  for (const addition of additions) {
    const value = addition.trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
    if (merged.length >= maximum) break;
  }
  return merged;
};

export function buildInventoryResearchValues(
  resource: InventoryResearchResource,
  research: InventoryResearchResult,
) {
  const values: InventoryResearchValues = {};
  const generatedFields: string[] = [];

  if (research.confidence < 0.55) return { values, generatedFields };

  if (
    research.confidence >= 0.65 &&
    isGenericTitle(resource.name) &&
    research.title
  ) {
    values.name = research.title;
    generatedFields.push("name");
  }

  if (research.additionalDescription) {
    const existing = resource.description.trim();
    const addition = research.additionalDescription.trim();
    const alreadyIncluded = existing.includes(addition);
    const combined = existing ? `${existing}\n\n${addition}` : addition;
    const description = combined.length <= 20_000 ? combined.trim() : existing;
    if (!alreadyIncluded && description && description !== existing) {
      values.description = description;
      generatedFields.push("description");
    }
  }

  if (
    research.confidence >= 0.65 &&
    resource.type === "object" &&
    research.type !== "object"
  ) {
    values.type = research.type;
    generatedFields.push("type");
  }

  const tags = mergeUniqueStrings(
    resource.tags,
    research.tags.map((tag) => tag.toLocaleLowerCase()),
    80,
  );
  if (tags.length !== resource.tags.length) {
    values.tags = tags;
    generatedFields.push("tags");
  }

  const categoryNames = mergeUniqueStrings(
    resource.categories.map((category) => category.name),
    research.categories,
    40,
  );
  if (categoryNames.length !== resource.categories.length) {
    const existingByName = new Map(
      resource.categories.map((category) => [
        category.name.toLocaleLowerCase(),
        category,
      ]),
    );
    values.categories = categoryNames.map(
      (name) => existingByName.get(name.toLocaleLowerCase()) ?? { name },
    );
    generatedFields.push("categories");
  }

  if (research.confidence >= 0.85) {
    if (!resource.sku && research.sku) {
      values.sku = research.sku;
      generatedFields.push("sku");
    }
    if (!resource.serialNumber && research.serialNumber) {
      values.serialNumber = research.serialNumber;
      generatedFields.push("serialNumber");
    }
    if (!resource.barcode && research.barcode) {
      values.barcode = research.barcode;
      generatedFields.push("barcode");
    }
    if (
      resource.valueCents === null &&
      research.valueCents !== null &&
      research.currency
    ) {
      values.valueCents = research.valueCents;
      values.currency = research.currency;
      generatedFields.push("valueCents", "currency");
    }
  }

  if (
    research.confidence >= 0.65 &&
    !resource.notes.trim() &&
    research.internalNotes
  ) {
    values.notes = research.internalNotes;
    generatedFields.push("notes");
  }

  return { values, generatedFields };
}
