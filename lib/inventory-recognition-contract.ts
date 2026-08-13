import { z } from "zod";

export const inventoryRecognitionObservationSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(160),
    brand: z.string().trim().min(1).max(160).nullable(),
    model: z.string().trim().min(1).max(160).nullable(),
    color: z.string().trim().min(1).max(120).nullable(),
    material: z.string().trim().min(1).max(120).nullable(),
    visibleText: z.array(z.string().trim().min(1).max(160)).max(20),
    searchTerms: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type InventoryRecognitionObservation = z.infer<
  typeof inventoryRecognitionObservationSchema
>;

export const inventoryRecognitionProviderMatchSchema = z
  .object({
    resourceId: z.string().uuid(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(600),
    evidence: z.array(z.string().trim().min(1).max(240)).max(8),
  })
  .strict();

export const inventoryRecognitionProviderResultSchema = z
  .object({
    matches: z.array(inventoryRecognitionProviderMatchSchema).max(5),
  })
  .strict();

export type InventoryRecognitionProviderMatch = z.infer<
  typeof inventoryRecognitionProviderMatchSchema
>;

export type InventoryRecognitionSearchCandidate = {
  id: string;
  name: string;
  description: string;
  type: string;
  sku: string | null;
  barcode: string | null;
  serialNumber: string | null;
  tags: string[];
  categories: Array<{ name: string }>;
  customFields: Record<string, unknown>;
  imageAltTexts: string[];
  updatedAt?: Date;
};

const normalizedText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokens = (value: unknown) =>
  new Set(
    normalizedText(value)
      .split(/\s+/)
      .filter((token) => token.length >= 2),
  );

const boundedJSON = (value: unknown, maximumLength = 2_000) => {
  try {
    return JSON.stringify(value).slice(0, maximumLength);
  } catch {
    return "";
  }
};

const phraseScore = (haystack: string, phrase: string, weight: number) => {
  const normalized = normalizedText(phrase);
  if (normalized.length < 2 || !haystack.includes(normalized)) return 0;
  return weight + Math.min(8, normalized.split(/\s+/).length * 2);
};

const tokenOverlapScore = (
  left: Set<string>,
  right: Set<string>,
  weight: number,
) => {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return (overlap / Math.max(1, left.size)) * weight;
};

/**
 * Produces a cheap, deterministic shortlist before the visual model sees any
 * inventory metadata or reference photos. The vision observation deliberately
 * includes common German and English synonyms so names such as "Fön" and
 * "hair dryer" can still meet in this local retrieval step.
 */
export function scoreInventoryRecognitionCandidate(
  observation: InventoryRecognitionObservation,
  candidate: InventoryRecognitionSearchCandidate,
) {
  const name = normalizedText(candidate.name);
  const identifiers = normalizedText(
    [candidate.sku, candidate.barcode, candidate.serialNumber]
      .filter(Boolean)
      .join(" "),
  );
  const descriptive = normalizedText(
    [
      candidate.description,
      candidate.type,
      candidate.tags.join(" "),
      candidate.categories.map((category) => category.name).join(" "),
      candidate.imageAltTexts.join(" "),
      boundedJSON(candidate.customFields),
    ].join(" "),
  );
  const allText = `${name} ${identifiers} ${descriptive}`.trim();
  const observationTerms = [
    observation.label,
    observation.category,
    observation.brand,
    observation.model,
    observation.color,
    observation.material,
    ...observation.visibleText,
    ...observation.searchTerms,
  ].filter((value): value is string => Boolean(value));

  let score = 0;
  for (const term of observation.searchTerms) {
    score += phraseScore(name, term, 15);
    score += phraseScore(descriptive, term, 7);
  }
  score += phraseScore(name, observation.label, 18);
  score += phraseScore(descriptive, observation.label, 9);
  score += phraseScore(allText, observation.category, 7);

  for (const exactSignal of [
    observation.brand,
    observation.model,
    ...observation.visibleText,
  ]) {
    if (!exactSignal) continue;
    score += phraseScore(name, exactSignal, 24);
    score += phraseScore(identifiers, exactSignal, 34);
    score += phraseScore(descriptive, exactSignal, 15);
  }

  const observationTokens = tokens(observationTerms.join(" "));
  score += tokenOverlapScore(observationTokens, tokens(name), 18);
  score += tokenOverlapScore(observationTokens, tokens(descriptive), 10);
  return Number(score.toFixed(4));
}

export function shortlistInventoryRecognitionCandidates(
  observation: InventoryRecognitionObservation,
  candidates: InventoryRecognitionSearchCandidate[],
  limit = 20,
) {
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreInventoryRecognitionCandidate(observation, candidate),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.candidate.updatedAt?.getTime() ?? 0) -
          (left.candidate.updatedAt?.getTime() ?? 0) ||
        left.candidate.id.localeCompare(right.candidate.id),
    )
    .slice(0, boundedLimit);
}

export const inventoryRecognitionIsConfident = (
  matches: ReadonlyArray<{ confidence: number }>,
  options: {
    observationConfidence?: number;
    leadingMatchHasReferenceImage?: boolean;
  } = {},
) => {
  const best = matches[0]?.confidence ?? 0;
  const runnerUp = matches[1]?.confidence ?? 0;
  return (
    (options.observationConfidence ?? 1) >= 0.75 &&
    (options.leadingMatchHasReferenceImage ?? true) &&
    best >= 0.78 &&
    (matches.length < 2 || best - runnerUp >= 0.12)
  );
};
