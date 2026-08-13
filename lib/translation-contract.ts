import { createHash } from "node:crypto";

export const coreTranslationFieldKeys = [
  "name",
  "description",
  "notes",
] as const;

export type CoreTranslationFieldKey =
  (typeof coreTranslationFieldKeys)[number];

export type TranslationMediaSource = {
  id: string;
  name?: string;
  kind?: string;
  altText: string;
};

export type TranslationSourceResource = {
  name: string;
  description: string;
  notes: string;
  type?: string;
  categories?: Array<string | { name: string }>;
  customFields: Record<string, unknown>;
  media?: TranslationMediaSource[];
  cover?: TranslationMediaSource | null;
};

export type TranslationCustomFieldDefinition = {
  key: string;
  label: string;
  description: string;
  fieldType: string;
  resourceTypes: string[];
  categories: string[];
};

export type TranslationDocument = {
  translatedFields: Record<string, string>;
  sourceHashes: Record<string, string>;
  manualFields: string[];
  suggestedFields: Record<string, string>;
  suggestionSourceHashes: Record<string, string>;
  policyHash: string;
};

export const emptyTranslationDocument = (): TranslationDocument => ({
  translatedFields: {},
  sourceHashes: {},
  manualFields: [],
  suggestedFields: {},
  suggestionSourceHashes: {},
  policyHash: "",
});

const languageCodePattern = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;
const customFieldKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeLanguageCode(value: string) {
  const candidate = value.trim().replaceAll("_", "-");
  if (!candidate || candidate.length > 35 || !languageCodePattern.test(candidate)) {
    throw new Error("Use a valid BCP 47 language code such as en, de, or pt-BR.");
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(candidate);
    if (!canonical) throw new Error();
    return canonical;
  } catch {
    throw new Error("Use a valid BCP 47 language code such as en, de, or pt-BR.");
  }
}

export const customTranslationFieldKey = (key: string) => {
  if (!customFieldKeyPattern.test(key)) {
    throw new Error(`Invalid custom field key: ${key}`);
  }
  return `custom.${key}`;
};

export const parseCustomTranslationFieldKey = (fieldKey: string) =>
  fieldKey.startsWith("custom.") &&
  customFieldKeyPattern.test(fieldKey.slice("custom.".length))
    ? fieldKey.slice("custom.".length)
    : null;

export const mediaTranslationFieldKey = (mediaId: string) => {
  if (!uuidPattern.test(mediaId)) throw new Error(`Invalid media ID: ${mediaId}`);
  return `media.${mediaId}.altText`;
};

export const parseMediaTranslationFieldKey = (fieldKey: string) => {
  const match = /^media\.([0-9a-f-]{36})\.altText$/i.exec(fieldKey);
  return match?.[1] && uuidPattern.test(match[1]) ? match[1] : null;
};

export function applicableTranslationDefinitions(
  resource: TranslationSourceResource,
  definitions: Iterable<TranslationCustomFieldDefinition>,
) {
  return Array.from(definitions).filter(
    (definition) =>
      ["text", "textarea"].includes(definition.fieldType) &&
      (definition.resourceTypes.length === 0 ||
        definition.resourceTypes.some(
          (type) =>
            type.trim().toLowerCase() ===
            (resource.type ?? "").trim().toLowerCase(),
        )) &&
      (definition.categories.length === 0 ||
        definition.categories.some((category) =>
          new Set(
            (resource.categories ?? []).map((value) =>
              (typeof value === "string" ? value : value.name)
                .trim()
                .toLowerCase(),
            ),
          ).has(category.trim().toLowerCase()),
        )),
  );
}

export function resourceTranslationFields(
  resource: TranslationSourceResource,
  definitions: Iterable<string | TranslationCustomFieldDefinition> = [],
) {
  const fields: Record<string, string> = {
    name: resource.name,
    description: resource.description,
    notes: resource.notes,
  };
  for (const entry of definitions) {
    const key = typeof entry === "string" ? entry : entry.key;
    if (
      typeof entry !== "string" &&
      !applicableTranslationDefinitions(resource, [entry]).length
    ) {
      continue;
    }
    const value = resource.customFields[key];
    if (typeof value === "string") {
      fields[customTranslationFieldKey(key)] = value;
    }
  }
  for (const item of resource.media ?? []) {
    fields[mediaTranslationFieldKey(item.id)] = item.altText;
  }
  return fields;
}

export const translationSourceHash = (fieldKey: string, sourceText: string) =>
  createHash("sha256")
    .update(`inventory-translation:v2\0${fieldKey}\0${sourceText}`)
    .digest("hex");

export function translationPolicyHash(language: {
  code: string;
  label: string;
  instructions: string;
}) {
  return createHash("sha256")
    .update(
      `inventory-translation-policy:v1\0${language.code}\0${language.label.trim()}\0${language.instructions.trim()}`,
    )
    .digest("hex");
}

export function translationFieldState(
  fieldKey: string,
  sourceText: string,
  document?: TranslationDocument | null,
  currentPolicyHash?: string,
) {
  if (!document || !Object.hasOwn(document.translatedFields, fieldKey)) {
    return "missing" as const;
  }
  const sourceHash = translationSourceHash(fieldKey, sourceText);
  const sourceIsCurrent = document.sourceHashes[fieldKey] === sourceHash;
  const isManual = document.manualFields.includes(fieldKey);
  if (isManual) {
    if (sourceIsCurrent) return "current" as const;
    return Object.hasOwn(document.suggestedFields, fieldKey) &&
      document.suggestionSourceHashes[fieldKey] === sourceHash
      ? ("needs_review" as const)
      : ("stale" as const);
  }
  return sourceIsCurrent &&
    (!currentPolicyHash || document.policyHash === currentPolicyHash)
    ? ("current" as const)
    : ("stale" as const);
}

export function translationWorkPlan(
  fields: Record<string, string>,
  document: TranslationDocument | null | undefined,
  currentPolicyHash: string,
  force = false,
) {
  const current = document ?? emptyTranslationDocument();
  const manual = new Set(current.manualFields);
  const translatedFields: Record<string, string> = {};
  const suggestionFields: Record<string, string> = {};
  for (const [fieldKey, sourceText] of Object.entries(fields)) {
    const sourceIsCurrent =
      current.sourceHashes[fieldKey] ===
      translationSourceHash(fieldKey, sourceText);
    if (manual.has(fieldKey)) {
      if (!sourceIsCurrent) suggestionFields[fieldKey] = sourceText;
      continue;
    }
    if (
      force ||
      !sourceIsCurrent ||
      current.policyHash !== currentPolicyHash ||
      !Object.hasOwn(current.translatedFields, fieldKey)
    ) {
      translatedFields[fieldKey] = sourceText;
    }
  }
  return { translatedFields, suggestionFields };
}

/** Compatibility helper used by tests and callers that only need a flat set. */
export function pendingTranslationFields(
  fields: Record<string, string>,
  document: TranslationDocument | null | undefined,
  force = false,
  currentPolicyHash = document?.policyHash ?? "",
) {
  const plan = translationWorkPlan(
    fields,
    document,
    currentPolicyHash,
    force,
  );
  return { ...plan.translatedFields, ...plan.suggestionFields };
}

export function applyCurrentTranslations<T extends TranslationSourceResource>(
  resource: T,
  definitions: Iterable<string | TranslationCustomFieldDefinition>,
  document: TranslationDocument | null | undefined,
  currentPolicyHash?: string,
) {
  const fields = resourceTranslationFields(resource, definitions);
  const localized = {
    ...resource,
    customFields: { ...resource.customFields },
    ...(resource.media
      ? { media: resource.media.map((item) => ({ ...item })) }
      : {}),
    ...(resource.cover ? { cover: { ...resource.cover } } : {}),
  } as T;
  const translatedFields: string[] = [];
  if (!document) return { resource: localized, translatedFields };

  for (const [fieldKey, sourceText] of Object.entries(fields)) {
    if (
      translationFieldState(
        fieldKey,
        sourceText,
        document,
        currentPolicyHash,
      ) !== "current"
    ) {
      continue;
    }
    const translatedText = document.translatedFields[fieldKey]!;
    if (fieldKey === "name") localized.name = translatedText;
    else if (fieldKey === "description") localized.description = translatedText;
    else if (fieldKey === "notes") localized.notes = translatedText;
    else {
      const customKey = parseCustomTranslationFieldKey(fieldKey);
      if (customKey) {
        localized.customFields[customKey] = translatedText;
      } else {
        const mediaId = parseMediaTranslationFieldKey(fieldKey);
        if (!mediaId) continue;
        if (localized.media) {
          const item = localized.media.find((candidate) => candidate.id === mediaId);
          if (item) item.altText = translatedText;
        }
        if (localized.cover?.id === mediaId) localized.cover.altText = translatedText;
      }
    }
    translatedFields.push(fieldKey);
  }
  return { resource: localized, translatedFields };
}

export function translationDocumentStatus(
  fields: Record<string, string>,
  document: TranslationDocument | null | undefined,
  currentPolicyHash: string,
) {
  const states = Object.entries(fields).map(([fieldKey, sourceText]) =>
    translationFieldState(fieldKey, sourceText, document, currentPolicyHash),
  );
  if (states.includes("needs_review")) return "needs_review" as const;
  if (states.every((state) => state === "current")) return "current" as const;
  return "stale" as const;
}

export function translationFieldLabel(
  fieldKey: string,
  definitions: Iterable<TranslationCustomFieldDefinition> = [],
  mediaItems: Iterable<TranslationMediaSource> = [],
) {
  const customKey = parseCustomTranslationFieldKey(fieldKey);
  if (customKey) {
    return (
      Array.from(definitions).find((definition) => definition.key === customKey)
        ?.label ??
      customKey
        .replace(/_+/g, " ")
        .replace(/^./, (character) => character.toUpperCase())
    );
  }
  const mediaId = parseMediaTranslationFieldKey(fieldKey);
  if (mediaId) {
    const media = Array.from(mediaItems).find((item) => item.id === mediaId);
    return media?.name ? `Alt text · ${media.name}` : "Media alt text";
  }
  return fieldKey.replace(/^./, (character) => character.toUpperCase());
}
