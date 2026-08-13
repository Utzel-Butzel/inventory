import "server-only";

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import {
  media,
  resourceTranslationJobs,
  resourceTranslations,
  resources,
  translationLanguages,
  type ResourceTranslationJobRecord,
  type ResourceTranslationRecord,
  type TranslationLanguageRecord,
} from "@/db/schema";
import { translateInventoryContent } from "@/lib/ai";
import {
  consumePaidAiRateLimit,
  type PaidAiRateLimitResult,
} from "@/lib/ai-rate-limit";
import { listCustomFieldDefinitions } from "@/lib/custom-fields";
import { db } from "@/lib/db";
import type { ResourceWithMedia } from "@/lib/resources";
import {
  applicableTranslationDefinitions,
  applyCurrentTranslations,
  emptyTranslationDocument,
  normalizeLanguageCode,
  resourceTranslationFields,
  translationDocumentStatus,
  translationFieldLabel,
  translationFieldState,
  translationPolicyHash,
  translationSourceHash,
  translationWorkPlan,
  type TranslationCustomFieldDefinition,
  type TranslationDocument,
} from "@/lib/translation-contract";

export class TranslationRateLimitError extends Error {
  constructor(public readonly result: PaidAiRateLimitResult) {
    super(
      result.disabled
        ? "AI translation is disabled by the administrator."
        : "AI translation request limit reached. Try again shortly.",
    );
    this.name = "TranslationRateLimitError";
  }
}

export class TranslationLanguageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationLanguageError";
  }
}

export class TranslationRevisionConflictError extends Error {
  constructor() {
    super("The translation changed while you were editing it. Reload and try again.");
    this.name = "TranslationRevisionConflictError";
  }
}

const languageSummary = (language: TranslationLanguageRecord) => ({
  code: language.code,
  label: language.label,
  isDefault: language.isDefault,
  autoTranslate: language.autoTranslate,
});

const translationDocument = (
  row?: ResourceTranslationRecord | null,
): TranslationDocument =>
  row
    ? {
        translatedFields: row.translatedFields,
        sourceHashes: row.sourceHashes,
        manualFields: row.manualFields,
        suggestedFields: row.suggestedFields,
        suggestionSourceHashes: row.suggestionSourceHashes,
        policyHash: row.policyHash,
      }
    : emptyTranslationDocument();

async function activeLanguages(organizationId: string) {
  return db
    .select()
    .from(translationLanguages)
    .where(
      and(
        eq(translationLanguages.organizationId, organizationId),
        isNull(translationLanguages.archivedAt),
      ),
    )
    .orderBy(
      asc(translationLanguages.position),
      asc(translationLanguages.label),
    );
}

function canonicalLanguage(languages: TranslationLanguageRecord[]) {
  const language = languages.find((candidate) => candidate.isDefault);
  if (!language) {
    throw new TranslationLanguageError(
      "No default content language is configured.",
    );
  }
  return language;
}

function resolveRequestedLanguage(
  languages: TranslationLanguageRecord[],
  requestedLanguageCode: string,
) {
  const normalized = normalizeLanguageCode(requestedLanguageCode);
  const exact = languages.find((candidate) => candidate.code === normalized);
  if (exact) return exact;
  const baseCode = normalized.split("-")[0];
  const base = languages.find((candidate) => candidate.code === baseCode);
  if (base) return base;
  throw new TranslationLanguageError(
    `Language ${normalized} is not enabled for this workspace.`,
  );
}

async function translationDefinitions(
  organizationId: string,
  executor: Pick<typeof db, "select"> = db,
) {
  const definitions = await listCustomFieldDefinitions({
    organizationId,
    entityType: "inventory",
    executor,
  });
  return definitions.filter((definition) =>
    ["text", "textarea"].includes(definition.fieldType),
  ) satisfies TranslationCustomFieldDefinition[];
}

async function resourceBundle(
  organizationId: string,
  resourceId: string,
  executor: Pick<typeof db, "select"> = db,
) {
  const [resource] = await executor
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, resourceId),
      ),
    )
    .limit(1);
  if (!resource) return null;
  const mediaRows = await executor
    .select()
    .from(media)
    .where(
      and(
        eq(media.organizationId, organizationId),
        eq(media.resourceId, resourceId),
      ),
    )
    .orderBy(asc(media.position));
  return {
    ...resource,
    media: mediaRows,
    cover: mediaRows.find((item) => item.kind === "image") ?? null,
  } satisfies ResourceWithMedia;
}

function applicableDefinitions(
  resource: ResourceWithMedia,
  definitions: TranslationCustomFieldDefinition[],
) {
  return applicableTranslationDefinitions(resource, definitions);
}

function safeInventoryTranslationContext(
  resource: ResourceWithMedia,
  definitions: TranslationCustomFieldDefinition[],
) {
  const applicable = applicableDefinitions(resource, definitions);
  return {
    item: {
      type: resource.type,
      status: resource.status,
      location: resource.location,
      tags: resource.tags,
      categories: resource.categories.map((category) => category.name),
    },
    customTextFields: applicable
      .filter(
        (definition) =>
          typeof resource.customFields[definition.key] === "string",
      )
      .map((definition) => ({
        fieldKey: `custom.${definition.key}`,
        label: definition.label,
        description: definition.description,
      })),
    media: resource.media.map((item) => ({
      fieldKey: `media.${item.id}.altText`,
      name: item.name,
      kind: item.kind,
    })),
  };
}

export async function enqueueResourceTranslations(options: {
  organizationId: string;
  resourceId: string;
  requestedBy: string;
  languageCodes?: string[];
  force?: boolean;
}) {
  const normalizedCodes = options.languageCodes?.map(normalizeLanguageCode);
  return db.transaction(async (transaction) => {
    const [resource] = await transaction
      .select({ id: resources.id, contentRevision: resources.contentRevision })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, options.organizationId),
          eq(resources.id, options.resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!resource) return { status: "not_found" as const, languageCodes: [] };
    const languages = await transaction
      .select()
      .from(translationLanguages)
      .where(
        and(
          eq(translationLanguages.organizationId, options.organizationId),
          isNull(translationLanguages.archivedAt),
          normalizedCodes?.length
            ? inArray(translationLanguages.code, normalizedCodes)
            : undefined,
        ),
      );
    const targets = languages.filter((language) => !language.isDefault);
    if (normalizedCodes) {
      const found = new Set(languages.map((language) => language.code));
      const missing = normalizedCodes.filter((code) => !found.has(code));
      if (missing.length) {
        throw new TranslationLanguageError(
          `Unknown or inactive target language: ${missing.join(", ")}.`,
        );
      }
    }
    for (const language of targets) {
      await transaction.execute(sql`
        SELECT "enqueue_resource_translation_job"(
          ${resource.id}::uuid,
          ${language.code}::varchar,
          ${resource.contentRevision}::integer,
          ${options.requestedBy}::varchar,
          ${options.force === true}::boolean,
          'manual'::varchar
        )
      `);
    }
    return {
      status: targets.length ? ("queued" as const) : ("not_needed" as const),
      languageCodes: targets.map((language) => language.code),
    };
  });
}

export async function enqueueTranslationBackfill(options: {
  organizationId: string;
  requestedBy: string;
  languageCodes?: string[];
  force?: boolean;
}) {
  const normalizedCodes = options.languageCodes?.map(normalizeLanguageCode);
  return db.transaction(async (transaction) => {
    const languages = await transaction
      .select()
      .from(translationLanguages)
      .where(
        and(
          eq(translationLanguages.organizationId, options.organizationId),
          isNull(translationLanguages.archivedAt),
          eq(translationLanguages.isDefault, false),
          normalizedCodes?.length
            ? inArray(translationLanguages.code, normalizedCodes)
            : undefined,
        ),
      );
    if (normalizedCodes) {
      const found = new Set(languages.map((language) => language.code));
      const missing = normalizedCodes.filter((code) => !found.has(code));
      if (missing.length) {
        throw new TranslationLanguageError(
          `Unknown or inactive target language: ${missing.join(", ")}.`,
        );
      }
    }
    const [{ value: resourceCount }] = await transaction
      .select({ value: sql<number>`count(*)::int` })
      .from(resources)
      .where(eq(resources.organizationId, options.organizationId));
    for (const language of languages) {
      await transaction.execute(sql`
        SELECT "enqueue_resource_translation_job"(
          "resource"."id",
          ${language.code}::varchar,
          "resource"."content_revision",
          ${options.requestedBy}::varchar,
          ${options.force === true}::boolean,
          'manual'::varchar
        )
        FROM "resources" AS "resource"
        WHERE "resource"."organization_id" = ${options.organizationId}::uuid
      `);
    }
    return {
      status: languages.length ? ("queued" as const) : ("not_needed" as const),
      resources: Number(resourceCount ?? 0),
      jobs: Number(resourceCount ?? 0) * languages.length,
      languageCodes: languages.map((language) => language.code),
    };
  });
}

export async function localizeResource<T extends ResourceWithMedia>(
  organizationId: string,
  resource: T,
  requestedLanguageCode?: string | null,
) {
  const [languages, definitions] = await Promise.all([
    activeLanguages(organizationId),
    translationDefinitions(organizationId),
  ]);
  const sourceLanguage = canonicalLanguage(languages);
  const availableLanguages = languages.map(languageSummary);
  if (!requestedLanguageCode) {
    return {
      resource,
      localization: {
        languageCode: sourceLanguage.code,
        defaultLanguageCode: sourceLanguage.code,
        isDefault: true,
        translatedFields: [] as string[],
        fallbackFields: [] as string[],
        availableLanguages,
      },
    };
  }
  let language: TranslationLanguageRecord;
  try {
    language = resolveRequestedLanguage(languages, requestedLanguageCode);
  } catch (error) {
    throw new TranslationLanguageError(
      error instanceof Error ? error.message : "Invalid language code.",
    );
  }
  if (language.isDefault) {
    return {
      resource,
      localization: {
        languageCode: language.code,
        defaultLanguageCode: sourceLanguage.code,
        isDefault: true,
        translatedFields: [] as string[],
        fallbackFields: [] as string[],
        availableLanguages,
      },
    };
  }
  const [row] = await db
    .select()
    .from(resourceTranslations)
    .where(
      and(
        eq(resourceTranslations.organizationId, organizationId),
        eq(resourceTranslations.resourceId, resource.id),
        eq(resourceTranslations.languageCode, language.code),
      ),
    )
    .limit(1);
  const applicable = applicableDefinitions(resource, definitions);
  const fields = resourceTranslationFields(resource, applicable);
  const document = row ? translationDocument(row) : null;
  const localized = applyCurrentTranslations(
    resource,
    applicable,
    document,
    translationPolicyHash(language),
  );
  const translatedSet = new Set(localized.translatedFields);
  return {
    resource: localized.resource,
    localization: {
      languageCode: language.code,
      defaultLanguageCode: sourceLanguage.code,
      isDefault: false,
      translatedFields: localized.translatedFields,
      fallbackFields: Object.keys(fields).filter(
        (fieldKey) => !translatedSet.has(fieldKey),
      ),
      availableLanguages,
    },
  };
}

export async function localizeResourceList<T extends ResourceWithMedia>(
  organizationId: string,
  resourceList: T[],
  requestedLanguageCode?: string | null,
) {
  if (!requestedLanguageCode || !resourceList.length) {
    return { resources: resourceList, localization: null };
  }
  const [languages, definitions] = await Promise.all([
    activeLanguages(organizationId),
    translationDefinitions(organizationId),
  ]);
  const sourceLanguage = canonicalLanguage(languages);
  let language: TranslationLanguageRecord;
  try {
    language = resolveRequestedLanguage(languages, requestedLanguageCode);
  } catch (error) {
    throw new TranslationLanguageError(
      error instanceof Error ? error.message : "Invalid language code.",
    );
  }
  if (language.isDefault) {
    return {
      resources: resourceList,
      localization: {
        languageCode: language.code,
        defaultLanguageCode: sourceLanguage.code,
        isDefault: true,
      },
    };
  }
  const rows = await db
    .select()
    .from(resourceTranslations)
    .where(
      and(
        eq(resourceTranslations.organizationId, organizationId),
        inArray(
          resourceTranslations.resourceId,
          resourceList.map((resource) => resource.id),
        ),
        eq(resourceTranslations.languageCode, language.code),
      ),
    );
  const byResourceId = new Map(rows.map((row) => [row.resourceId, row]));
  const policyHash = translationPolicyHash(language);
  return {
    resources: resourceList.map((resource) => {
      const applicable = applicableDefinitions(resource, definitions);
      const row = byResourceId.get(resource.id);
      return applyCurrentTranslations(
        resource,
        applicable,
        row ? translationDocument(row) : null,
        policyHash,
      ).resource;
    }),
    localization: {
      languageCode: language.code,
      defaultLanguageCode: sourceLanguage.code,
      isDefault: false,
    },
  };
}

export async function getResourceTranslationOverview(
  organizationId: string,
  resourceId: string,
) {
  const [resource, languages, definitions, rows, jobs] = await Promise.all([
    resourceBundle(organizationId, resourceId),
    activeLanguages(organizationId),
    translationDefinitions(organizationId),
    db
      .select()
      .from(resourceTranslations)
      .where(
        and(
          eq(resourceTranslations.organizationId, organizationId),
          eq(resourceTranslations.resourceId, resourceId),
        ),
      ),
    db
      .select()
      .from(resourceTranslationJobs)
      .where(
        and(
          eq(resourceTranslationJobs.organizationId, organizationId),
          eq(resourceTranslationJobs.resourceId, resourceId),
        ),
      ),
  ]);
  if (!resource) return null;
  const sourceLanguage = canonicalLanguage(languages);
  const applicable = applicableDefinitions(resource, definitions);
  const fields = resourceTranslationFields(resource, applicable);
  const rowByLanguage = new Map(rows.map((row) => [row.languageCode, row]));
  const jobByLanguage = new Map(jobs.map((job) => [job.languageCode, job]));

  return {
    resourceId,
    contentRevision: resource.contentRevision,
    defaultLanguage: languageSummary(sourceLanguage),
    languages: languages
      .filter((language) => !language.isDefault)
      .map((language) => {
        const row = rowByLanguage.get(language.code);
        const document = row ? translationDocument(row) : null;
        const job = jobByLanguage.get(language.code);
        const policyHash = translationPolicyHash(language);
        const fieldStates = Object.entries(fields).map(
          ([fieldKey, sourceText]) => {
            const baseState = translationFieldState(
              fieldKey,
              sourceText,
              document,
              policyHash,
            );
            const state =
              baseState === "current" || baseState === "needs_review" || !job
                ? baseState
                : job.status === "processing"
                  ? ("processing" as const)
                  : job.status === "pending"
                    ? ("pending" as const)
                    : ("failed" as const);
            return {
              fieldKey,
              label: translationFieldLabel(
                fieldKey,
                applicable,
                resource.media,
              ),
              sourceText,
              translatedText: document?.translatedFields[fieldKey] ?? null,
              suggestion: document?.suggestedFields[fieldKey] ?? null,
              state,
              origin: document?.manualFields.includes(fieldKey)
                ? ("manual" as const)
                : document && Object.hasOwn(document.translatedFields, fieldKey)
                  ? ("ai" as const)
                  : null,
              model: row?.model ?? null,
              updatedAt: row?.updatedAt ?? null,
            };
          },
        );
        const currentCount = fieldStates.filter(
          (field) => field.state === "current",
        ).length;
        const hasNeedsReview = fieldStates.some(
          (field) => field.state === "needs_review",
        );
        const aggregateStatus =
          currentCount === fieldStates.length
            ? ("current" as const)
            : hasNeedsReview
              ? ("needs_review" as const)
              : job?.status === "processing"
                ? ("processing" as const)
                : job?.status === "pending"
                  ? ("pending" as const)
                  : job?.status === "failed"
                    ? ("failed" as const)
                    : row
                      ? ("stale" as const)
                      : ("missing" as const);
        return {
          ...languageSummary(language),
          revision: row?.revision ?? 0,
          status: aggregateStatus,
          currentCount,
          totalCount: fieldStates.length,
          lastError: job?.lastError ?? row?.lastError ?? null,
          job: job
            ? {
                status: job.status,
                attempts: job.attempts,
                runAfter: job.runAfter,
                updatedAt: job.updatedAt,
              }
            : null,
          fields: fieldStates,
        };
      }),
  };
}

export type ManualTranslationOperation =
  | { action: "set"; fieldKey: string; translatedText: string }
  | { action: "accept_suggestion"; fieldKey: string }
  | { action: "use_ai"; fieldKey: string };

function pruneDocument(
  document: TranslationDocument,
  currentFieldKeys: Set<string>,
) {
  for (const map of [
    document.translatedFields,
    document.sourceHashes,
    document.suggestedFields,
    document.suggestionSourceHashes,
  ]) {
    for (const key of Object.keys(map)) {
      if (!currentFieldKeys.has(key)) delete map[key];
    }
  }
  document.manualFields = document.manualFields.filter((key) =>
    currentFieldKeys.has(key),
  );
}

export async function updateManualResourceTranslation(options: {
  organizationId: string;
  resourceId: string;
  languageCode: string;
  expectedRevision: number;
  operations: ManualTranslationOperation[];
  actor: string;
}) {
  const languageCode = normalizeLanguageCode(options.languageCode);
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`
      SELECT ${resources.id}
      FROM ${resources}
      WHERE ${resources.organizationId} = ${options.organizationId}
        AND ${resources.id} = ${options.resourceId}
      FOR UPDATE
    `);
    const resource = await resourceBundle(
      options.organizationId,
      options.resourceId,
      transaction,
    );
    if (!resource) return { status: "not_found" as const };
    const [targetLanguage] = await transaction
      .select()
      .from(translationLanguages)
      .where(
        and(
          eq(translationLanguages.organizationId, options.organizationId),
          eq(translationLanguages.code, languageCode),
          isNull(translationLanguages.archivedAt),
        ),
      )
      .limit(1);
    if (!targetLanguage || targetLanguage.isDefault) {
      throw new TranslationLanguageError(
        `Language ${languageCode} is not an active target language.`,
      );
    }
    // Match the worker's job -> document lock order before changing a locale
    // document. This prevents a manual unlock from deadlocking with a save.
    await transaction
      .select({ resourceId: resourceTranslationJobs.resourceId })
      .from(resourceTranslationJobs)
      .where(
        and(
          eq(resourceTranslationJobs.organizationId, options.organizationId),
          eq(resourceTranslationJobs.resourceId, options.resourceId),
          eq(resourceTranslationJobs.languageCode, languageCode),
        ),
      )
      .limit(1)
      .for("update");
    const [row] = await transaction
      .select()
      .from(resourceTranslations)
      .where(
        and(
          eq(resourceTranslations.organizationId, options.organizationId),
          eq(resourceTranslations.resourceId, options.resourceId),
          eq(resourceTranslations.languageCode, languageCode),
        ),
      )
      .limit(1)
      .for("update");
    if ((row?.revision ?? 0) !== options.expectedRevision) {
      throw new TranslationRevisionConflictError();
    }
    const definitions = await translationDefinitions(
      options.organizationId,
      transaction,
    );
    const applicable = applicableDefinitions(resource, definitions);
    const fields = resourceTranslationFields(resource, applicable);
    const currentKeys = new Set(Object.keys(fields));
    const document = translationDocument(row);
    pruneDocument(document, currentKeys);
    let enqueueAi = false;
    for (const operation of options.operations) {
      const sourceText = fields[operation.fieldKey];
      if (sourceText === undefined) {
        throw new TranslationLanguageError(
          `Field ${operation.fieldKey} is not translatable on this item.`,
        );
      }
      if (operation.action === "set") {
        document.translatedFields[operation.fieldKey] = operation.translatedText;
        document.sourceHashes[operation.fieldKey] = translationSourceHash(
          operation.fieldKey,
          sourceText,
        );
        if (!document.manualFields.includes(operation.fieldKey)) {
          document.manualFields.push(operation.fieldKey);
        }
        delete document.suggestedFields[operation.fieldKey];
        delete document.suggestionSourceHashes[operation.fieldKey];
      } else if (operation.action === "accept_suggestion") {
        const sourceHash = translationSourceHash(operation.fieldKey, sourceText);
        const suggestion = document.suggestedFields[operation.fieldKey];
        if (
          suggestion === undefined ||
          document.suggestionSourceHashes[operation.fieldKey] !== sourceHash
        ) {
          throw new TranslationRevisionConflictError();
        }
        document.translatedFields[operation.fieldKey] = suggestion;
        document.sourceHashes[operation.fieldKey] = sourceHash;
        if (!document.manualFields.includes(operation.fieldKey)) {
          document.manualFields.push(operation.fieldKey);
        }
        delete document.suggestedFields[operation.fieldKey];
        delete document.suggestionSourceHashes[operation.fieldKey];
      } else {
        document.manualFields = document.manualFields.filter(
          (fieldKey) => fieldKey !== operation.fieldKey,
        );
        delete document.translatedFields[operation.fieldKey];
        delete document.sourceHashes[operation.fieldKey];
        delete document.suggestedFields[operation.fieldKey];
        delete document.suggestionSourceHashes[operation.fieldKey];
        enqueueAi = true;
      }
    }
    const status = translationDocumentStatus(
      fields,
      document,
      translationPolicyHash(targetLanguage),
    );
    const [saved] = await transaction
      .insert(resourceTranslations)
      .values({
        organizationId: options.organizationId,
        resourceId: resource.id,
        languageCode,
        ...document,
        status,
        updatedBy: options.actor,
      })
      .onConflictDoUpdate({
        target: [
          resourceTranslations.organizationId,
          resourceTranslations.resourceId,
          resourceTranslations.languageCode,
        ],
        set: {
          translatedFields: document.translatedFields,
          sourceHashes: document.sourceHashes,
          manualFields: document.manualFields,
          suggestedFields: document.suggestedFields,
          suggestionSourceHashes: document.suggestionSourceHashes,
          policyHash: document.policyHash,
          status,
          lastError: null,
          revision: sql`${resourceTranslations.revision} + 1`,
          updatedBy: options.actor,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (enqueueAi) {
      await transaction.execute(sql`
        SELECT "enqueue_resource_translation_job"(
          ${resource.id}::uuid,
          ${languageCode}::varchar,
          ${resource.contentRevision}::integer,
          ${options.actor}::varchar,
          true,
          'manual'::varchar
        )
      `);
    }
    return { status: "updated" as const, translation: saved };
  });
}

const leaseDurationMs = () => {
  const configured = Number(process.env.TRANSLATION_JOB_LEASE_SECONDS ?? "180");
  const requestedLease = Number.isFinite(configured)
    ? Math.min(1_800_000, Math.max(30_000, Math.round(configured * 1_000)))
    : 180_000;
  const configuredProviderTimeout = Number(
    process.env.OPENAI_TRANSLATION_TIMEOUT_MS ?? "120000",
  );
  const providerTimeout = Number.isSafeInteger(configuredProviderTimeout)
    ? Math.min(300_000, Math.max(10_000, configuredProviderTimeout))
    : 120_000;
  return Math.max(requestedLease, providerTimeout + 30_000);
};

const maximumAttempts = () => {
  const configured = Number(process.env.TRANSLATION_JOB_MAX_ATTEMPTS ?? "5");
  return Number.isSafeInteger(configured)
    ? Math.min(10, Math.max(1, configured))
    : 5;
};

export function translationRetryDelayMs(attempt: number) {
  return Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

async function claimTranslationJob() {
  return db.transaction(async (transaction) => {
    const now = new Date();
    const [candidate] = await transaction
      .select()
      .from(resourceTranslationJobs)
      .where(
        or(
          and(
            eq(resourceTranslationJobs.status, "pending"),
            lte(resourceTranslationJobs.runAfter, now),
          ),
          and(
            eq(resourceTranslationJobs.status, "processing"),
            isNotNull(resourceTranslationJobs.leaseExpiresAt),
            lte(resourceTranslationJobs.leaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(
        asc(resourceTranslationJobs.runAfter),
        asc(resourceTranslationJobs.createdAt),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const leaseToken = randomUUID();
    const [claimed] = await transaction
      .update(resourceTranslationJobs)
      .set({
        status: "processing",
        attempts: sql`${resourceTranslationJobs.attempts} + 1`,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + leaseDurationMs()),
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            resourceTranslationJobs.organizationId,
            candidate.organizationId,
          ),
          eq(resourceTranslationJobs.resourceId, candidate.resourceId),
          eq(resourceTranslationJobs.languageCode, candidate.languageCode),
        ),
      )
      .returning();
    return claimed ?? null;
  });
}

async function discardClaim(job: ResourceTranslationJobRecord) {
  await db
    .delete(resourceTranslationJobs)
    .where(
      and(
        eq(resourceTranslationJobs.organizationId, job.organizationId),
        eq(resourceTranslationJobs.resourceId, job.resourceId),
        eq(resourceTranslationJobs.languageCode, job.languageCode),
        eq(resourceTranslationJobs.generation, job.generation),
        eq(resourceTranslationJobs.leaseToken, job.leaseToken!),
      ),
    );
}

async function saveJobTranslations(options: {
  job: ResourceTranslationJobRecord;
  sourceFields: Record<string, string>;
  policyHash: string;
  output: Record<string, string>;
  model: string | null;
}) {
  return db.transaction(async (transaction) => {
    const [lockedJob] = await transaction
      .select()
      .from(resourceTranslationJobs)
      .where(
        and(
          eq(
            resourceTranslationJobs.organizationId,
            options.job.organizationId,
          ),
          eq(resourceTranslationJobs.resourceId, options.job.resourceId),
          eq(resourceTranslationJobs.languageCode, options.job.languageCode),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !lockedJob ||
      lockedJob.status !== "processing" ||
      lockedJob.generation !== options.job.generation ||
      lockedJob.leaseToken !== options.job.leaseToken
    ) {
      return "superseded" as const;
    }
    const resource = await resourceBundle(
      options.job.organizationId,
      options.job.resourceId,
      transaction,
    );
    const [language] = await transaction
      .select()
      .from(translationLanguages)
      .where(
        and(
          eq(translationLanguages.organizationId, options.job.organizationId),
          eq(translationLanguages.code, options.job.languageCode),
          isNull(translationLanguages.archivedAt),
        ),
      )
      .limit(1);
    if (!resource || !language || language.isDefault) {
      await transaction
        .delete(resourceTranslationJobs)
        .where(
          and(
            eq(
              resourceTranslationJobs.organizationId,
              options.job.organizationId,
            ),
            eq(resourceTranslationJobs.resourceId, options.job.resourceId),
            eq(resourceTranslationJobs.languageCode, options.job.languageCode),
          ),
        );
      return "discarded" as const;
    }
    const definitions = await translationDefinitions(
      options.job.organizationId,
      transaction,
    );
    const currentPolicyHash = translationPolicyHash(language);
    const applicable = applicableDefinitions(resource, definitions);
    const currentFields = resourceTranslationFields(resource, applicable);
    const sourcesChanged =
      currentPolicyHash !== options.policyHash ||
      Object.entries(options.sourceFields).some(
        ([fieldKey, sourceText]) =>
          currentFields[fieldKey] === undefined ||
          translationSourceHash(fieldKey, currentFields[fieldKey]!) !==
            translationSourceHash(fieldKey, sourceText),
      );
    if (sourcesChanged) {
      await transaction.execute(sql`
        SELECT "enqueue_resource_translation_job"(
          ${resource.id}::uuid,
          ${language.code}::varchar,
          ${resource.contentRevision}::integer,
          ${lockedJob.requestedBy}::varchar,
          ${lockedJob.force}::boolean,
          ${lockedJob.mode}::varchar
        )
      `);
      return "superseded" as const;
    }
    const [existing] = await transaction
      .select()
      .from(resourceTranslations)
      .where(
        and(
          eq(resourceTranslations.organizationId, options.job.organizationId),
          eq(resourceTranslations.resourceId, resource.id),
          eq(resourceTranslations.languageCode, language.code),
        ),
      )
      .limit(1)
      .for("update");
    const document = translationDocument(existing);
    const currentKeys = new Set(Object.keys(currentFields));
    pruneDocument(document, currentKeys);
    for (const [fieldKey, translatedText] of Object.entries(options.output)) {
      const sourceText = currentFields[fieldKey];
      if (sourceText === undefined) continue;
      const sourceHash = translationSourceHash(fieldKey, sourceText);
      if (document.manualFields.includes(fieldKey)) {
        if (document.sourceHashes[fieldKey] !== sourceHash) {
          document.suggestedFields[fieldKey] = translatedText;
          document.suggestionSourceHashes[fieldKey] = sourceHash;
        }
      } else {
        document.translatedFields[fieldKey] = translatedText;
        document.sourceHashes[fieldKey] = sourceHash;
        delete document.suggestedFields[fieldKey];
        delete document.suggestionSourceHashes[fieldKey];
      }
    }
    document.policyHash = currentPolicyHash;
    const status = translationDocumentStatus(
      currentFields,
      document,
      currentPolicyHash,
    );
    await transaction
      .insert(resourceTranslations)
      .values({
        organizationId: options.job.organizationId,
        resourceId: resource.id,
        languageCode: language.code,
        ...document,
        status,
        model: options.model,
        updatedBy: lockedJob.requestedBy,
      })
      .onConflictDoUpdate({
        target: [
          resourceTranslations.organizationId,
          resourceTranslations.resourceId,
          resourceTranslations.languageCode,
        ],
        set: {
          translatedFields: document.translatedFields,
          sourceHashes: document.sourceHashes,
          manualFields: document.manualFields,
          suggestedFields: document.suggestedFields,
          suggestionSourceHashes: document.suggestionSourceHashes,
          policyHash: document.policyHash,
          status,
          model: options.model,
          lastError: null,
          revision: sql`${resourceTranslations.revision} + 1`,
          updatedBy: lockedJob.requestedBy,
          updatedAt: new Date(),
        },
      });
    await transaction
      .delete(resourceTranslationJobs)
      .where(
        and(
          eq(
            resourceTranslationJobs.organizationId,
            lockedJob.organizationId,
          ),
          eq(resourceTranslationJobs.resourceId, lockedJob.resourceId),
          eq(resourceTranslationJobs.languageCode, lockedJob.languageCode),
          eq(resourceTranslationJobs.generation, lockedJob.generation),
          eq(resourceTranslationJobs.leaseToken, lockedJob.leaseToken!),
        ),
      );
    return "saved" as const;
  });
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "AI translation failed.").slice(
    0,
    2_000,
  );
}

function terminalTranslationFailure(error: unknown) {
  if (error instanceof TranslationRateLimitError) return error.result.disabled;
  const message = errorMessage(error);
  if (
    message.includes("OPENAI_API_KEY is not configured") ||
    message.includes("No default content language")
  ) {
    return true;
  }
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  return status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}

async function failClaim(job: ResourceTranslationJobRecord, error: unknown) {
  const message = errorMessage(error);
  const exhausted = job.attempts >= maximumAttempts();
  const terminal = exhausted || terminalTranslationFailure(error);
  let runAfter = new Date(
    Date.now() + translationRetryDelayMs(Math.max(1, job.attempts)),
  );
  if (
    error instanceof TranslationRateLimitError &&
    !error.result.disabled &&
    error.result.resetsAt.getTime() > Date.now()
  ) {
    runAfter = new Date(error.result.resetsAt.getTime() + 1_000);
  }
  await db.transaction(async (transaction) => {
    const [updated] = await transaction
      .update(resourceTranslationJobs)
      .set({
        status: terminal ? "failed" : "pending",
        runAfter,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(resourceTranslationJobs.organizationId, job.organizationId),
          eq(resourceTranslationJobs.resourceId, job.resourceId),
          eq(resourceTranslationJobs.languageCode, job.languageCode),
          eq(resourceTranslationJobs.generation, job.generation),
          eq(resourceTranslationJobs.leaseToken, job.leaseToken!),
        ),
      )
      .returning({ resourceId: resourceTranslationJobs.resourceId });
    if (terminal && updated) {
      await transaction
        .insert(resourceTranslations)
        .values({
          organizationId: job.organizationId,
          resourceId: job.resourceId,
          languageCode: job.languageCode,
          status: "failed",
          lastError: message,
          updatedBy: job.requestedBy,
        })
        .onConflictDoUpdate({
          target: [
            resourceTranslations.organizationId,
            resourceTranslations.resourceId,
            resourceTranslations.languageCode,
          ],
          set: {
            status: "failed",
            lastError: message,
            updatedBy: job.requestedBy,
            updatedAt: new Date(),
          },
        });
    }
  });
}

async function processTranslationJob(job: ResourceTranslationJobRecord) {
  try {
    const [resource, languages, definitions, rows] = await Promise.all([
      resourceBundle(job.organizationId, job.resourceId),
      activeLanguages(job.organizationId),
      translationDefinitions(job.organizationId),
      db
        .select()
        .from(resourceTranslations)
        .where(
          and(
            eq(resourceTranslations.organizationId, job.organizationId),
            eq(resourceTranslations.resourceId, job.resourceId),
            eq(resourceTranslations.languageCode, job.languageCode),
          ),
        )
        .limit(1),
    ]);
    const language = languages.find(
      (candidate) => candidate.code === job.languageCode,
    );
    if (
      !resource ||
      !language ||
      language.isDefault ||
      (job.mode === "automatic" && !language.autoTranslate)
    ) {
      await discardClaim(job);
      return "discarded" as const;
    }
    const sourceLanguage = canonicalLanguage(languages);
    const applicable = applicableDefinitions(resource, definitions);
    const fields = resourceTranslationFields(resource, applicable);
    const document = rows[0] ? translationDocument(rows[0]) : null;
    const policyHash = translationPolicyHash(language);
    const plan = translationWorkPlan(fields, document, policyHash, job.force);
    const requestedFields = {
      ...plan.translatedFields,
      ...plan.suggestionFields,
    };
    const output: Record<string, string> = {};
    const aiFields: Record<string, string> = {};
    for (const [fieldKey, sourceText] of Object.entries(requestedFields)) {
      if (sourceText === "") output[fieldKey] = "";
      else aiFields[fieldKey] = sourceText;
    }
    let model: string | null = null;
    if (Object.keys(aiFields).length) {
      const limit = await consumePaidAiRateLimit({
        organizationId: job.organizationId,
        operation: "translate",
        identity: { subject: job.requestedBy },
      });
      if (!limit.allowed) throw new TranslationRateLimitError(limit);
      const result = await translateInventoryContent({
        sourceLanguageCode: sourceLanguage.code,
        sourceLanguageLabel: sourceLanguage.label,
        context: safeInventoryTranslationContext(resource, definitions),
        target: {
          languageCode: language.code,
          languageLabel: language.label,
          instructions: language.instructions,
          fields: aiFields,
        },
        idempotencyKey: job.requestId,
      });
      Object.assign(output, result.translations);
      model = result.model;
    }
    return await saveJobTranslations({
      job,
      sourceFields: requestedFields,
      policyHash,
      output,
      model,
    });
  } catch (error) {
    await failClaim(job, error);
    return "failed" as const;
  }
}

export async function drainTranslationJobs(limit = 1) {
  const boundedLimit = Math.min(20, Math.max(1, limit));
  const results: string[] = [];
  for (let index = 0; index < boundedLimit; index += 1) {
    const job = await claimTranslationJob();
    if (!job) break;
    results.push(await processTranslationJob(job));
  }
  return { processed: results.length, results };
}
