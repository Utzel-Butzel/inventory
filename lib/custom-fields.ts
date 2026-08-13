import "server-only";

import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  customFieldDefinitions,
  resources,
  stockUnits,
  type CustomFieldDefinitionRecord,
} from "@/db/schema";
import {
  isCustomFieldDefinitionApplicable,
  normalizeCustomFieldKey,
  type CustomFieldDefinition,
  type CustomFieldEntityType,
  type CustomFieldReferenceOption,
  type CustomFieldTarget,
  type CustomFieldValue,
  type CustomFieldValues,
} from "@/lib/custom-field-contract";
import { db } from "@/lib/db";
import {
  customFieldDefinitionCreateSchema,
  type customFieldDefinitionPatchSchema,
} from "@/lib/validators";
import type { z } from "zod";

type CustomFieldDefinitionPatch = z.infer<
  typeof customFieldDefinitionPatchSchema
>;

type CustomFieldQueryExecutor = Pick<typeof db, "select">;

export class CustomFieldError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 | 500 = 422,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CustomFieldError";
  }
}

export function customFieldHttpError(error: unknown, fallback: string) {
  if (error instanceof CustomFieldError) {
    return {
      status: error.status,
      message: error.message,
      details: error.details,
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("custom_field_definitions_entity_key_unique")) {
    return {
      status: 409 as const,
      message: "That custom field key is already in use for this entity type.",
      details: undefined,
    };
  }
  return { status: 500 as const, message: fallback, details: undefined };
}

const definitionDto = (
  row: CustomFieldDefinitionRecord,
): CustomFieldDefinition => ({
  id: row.id,
  entityType: row.entityType,
  key: row.key,
  label: row.label,
  description: row.description,
  placeholder: row.placeholder,
  fieldType: row.fieldType,
  required: row.required,
  minValue: row.minValue,
  maxValue: row.maxValue,
  step: row.step,
  resourceTypes: row.resourceTypes,
  categories: row.categories,
  options: row.options,
  referenceEntityType: row.referenceEntityType,
  referenceMultiple: row.referenceMultiple,
  referenceResourceTypes: row.referenceResourceTypes,
  referenceCategories: row.referenceCategories,
  referenceStatuses: row.referenceStatuses,
  position: row.position,
  revision: row.revision,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

export async function listCustomFieldDefinitions(options: {
  entityType?: CustomFieldEntityType;
  includeArchived?: boolean;
  executor?: CustomFieldQueryExecutor;
} = {}) {
  const conditions = [];
  if (options.entityType) {
    conditions.push(eq(customFieldDefinitions.entityType, options.entityType));
  }
  if (!options.includeArchived) {
    conditions.push(isNull(customFieldDefinitions.archivedAt));
  }
  const rows = await (options.executor ?? db)
    .select()
    .from(customFieldDefinitions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      asc(customFieldDefinitions.entityType),
      asc(customFieldDefinitions.position),
      asc(customFieldDefinitions.label),
      asc(customFieldDefinitions.id),
    );
  return rows.map(definitionDto);
}

export async function getCustomFieldDefinition(id: string) {
  const [row] = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.id, id))
    .limit(1);
  return row ? definitionDto(row) : null;
}

export async function createCustomFieldDefinition(
  input: z.infer<typeof customFieldDefinitionCreateSchema>,
  actor: string,
) {
  const key = normalizeCustomFieldKey(input.key ?? input.label);
  if (!key) {
    throw new CustomFieldError(
      "Provide a key containing at least one Latin letter or number.",
      422,
    );
  }
  try {
    const [created] = await db
      .insert(customFieldDefinitions)
      .values({ ...input, key, createdBy: actor, updatedBy: actor })
      .returning();
    return definitionDto(created);
  } catch (error) {
    const failure = customFieldHttpError(
      error,
      "Unable to create the custom field definition.",
    );
    throw new CustomFieldError(failure.message, failure.status, failure.details);
  }
}

export async function updateCustomFieldDefinition(
  id: string,
  patch: CustomFieldDefinitionPatch,
  actor: string,
) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.id, id))
      .limit(1)
      .for("update");
    if (!current || current.archivedAt) {
      throw new CustomFieldError("Custom field definition not found.", 404);
    }
    if (current.revision !== patch.revision) {
      throw new CustomFieldError(
        "The custom field definition was changed by another request. Reload it and try again.",
        409,
        { currentRevision: current.revision },
      );
    }

    const { revision, ...patchChanges } = patch;
    const merged = customFieldDefinitionCreateSchema.safeParse({
      entityType: current.entityType,
      key: current.key,
      label: current.label,
      description: current.description,
      placeholder: current.placeholder,
      fieldType: current.fieldType,
      required: current.required,
      minValue: current.minValue,
      maxValue: current.maxValue,
      step: current.step,
      resourceTypes: current.resourceTypes,
      categories: current.categories,
      options: current.options,
      referenceEntityType: current.referenceEntityType,
      referenceMultiple: current.referenceMultiple,
      referenceResourceTypes: current.referenceResourceTypes,
      referenceCategories: current.referenceCategories,
      referenceStatuses: current.referenceStatuses,
      position: current.position,
      ...patchChanges,
    });
    if (!merged.success) {
      throw new CustomFieldError(
        "The combined custom field definition is invalid.",
        422,
        { validation: merged.error.flatten() },
      );
    }

    const changes = {
      label: merged.data.label,
      description: merged.data.description,
      placeholder: merged.data.placeholder,
      fieldType: merged.data.fieldType,
      required: merged.data.required,
      minValue: merged.data.minValue,
      maxValue: merged.data.maxValue,
      step: merged.data.step,
      resourceTypes: merged.data.resourceTypes,
      categories: merged.data.categories,
      options: merged.data.options,
      referenceEntityType: merged.data.referenceEntityType,
      referenceMultiple: merged.data.referenceMultiple,
      referenceResourceTypes: merged.data.referenceResourceTypes,
      referenceCategories: merged.data.referenceCategories,
      referenceStatuses: merged.data.referenceStatuses,
      position: merged.data.position,
    };
    const [saved] = await transaction
      .update(customFieldDefinitions)
      .set({
        ...changes,
        revision: sql`${customFieldDefinitions.revision} + 1`,
        updatedBy: actor,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customFieldDefinitions.id, id),
          eq(customFieldDefinitions.revision, revision),
        ),
      )
      .returning();
    if (!saved) {
      throw new CustomFieldError(
        "The custom field definition was changed by another request. Reload it and try again.",
        409,
      );
    }
    return definitionDto(saved);
  });
}

export async function archiveCustomFieldDefinition(id: string, actor: string) {
  const now = new Date();
  const [archived] = await db
    .update(customFieldDefinitions)
    .set({
      archivedAt: now,
      updatedAt: now,
      updatedBy: actor,
      revision: sql`${customFieldDefinitions.revision} + 1`,
    })
    .where(
      and(
        eq(customFieldDefinitions.id, id),
        isNull(customFieldDefinitions.archivedAt),
      ),
    )
    .returning({ id: customFieldDefinitions.id });
  if (!archived) {
    const existing = await getCustomFieldDefinition(id);
    if (!existing) throw new CustomFieldError("Custom field definition not found.", 404);
  }
  return Boolean(archived);
}

const hasValue = (value: CustomFieldValue | undefined) =>
  value !== undefined &&
  (typeof value !== "string" || value.trim().length > 0) &&
  (!Array.isArray(value) || value.length > 0);

const invalidValue = (
  definition: CustomFieldDefinition,
  message: string,
): never => {
  throw new CustomFieldError(
    `Invalid value for ${definition.label}: ${message}`,
    422,
    { field: definition.key, fieldType: definition.fieldType },
  );
};

const validCalendarDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validateValue = (
  definition: CustomFieldDefinition,
  value: CustomFieldValue,
): CustomFieldValue => {
  if (definition.fieldType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return invalidValue(definition, "expected a finite number.");
    }
    if (definition.minValue !== null && value < definition.minValue) {
      return invalidValue(definition, `must be at least ${definition.minValue}.`);
    }
    if (definition.maxValue !== null && value > definition.maxValue) {
      return invalidValue(definition, `must be at most ${definition.maxValue}.`);
    }
    if (definition.step !== null) {
      const origin = definition.minValue ?? 0;
      const quotient = (value - origin) / definition.step;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-8) {
        return invalidValue(definition, `must use increments of ${definition.step}.`);
      }
    }
    return value;
  }

  if (definition.fieldType === "boolean") {
    if (typeof value !== "boolean") {
      return invalidValue(definition, "expected true or false.");
    }
    return value;
  }

  if (definition.fieldType === "multi_select") {
    if (!Array.isArray(value)) {
      return invalidValue(definition, "expected a list of option values.");
    }
    if (new Set(value).size !== value.length) {
      return invalidValue(definition, "option values must be unique.");
    }
    const allowed = new Set(definition.options.map((option) => option.value));
    if (value.some((entry) => !allowed.has(entry))) {
      return invalidValue(definition, "contains an option that is not configured.");
    }
    return value;
  }

  if (definition.fieldType === "reference") {
    const references = definition.referenceMultiple
      ? Array.isArray(value)
        ? value
        : invalidValue(definition, "expected a list of referenced record IDs.")
      : typeof value === "string"
        ? [value]
        : invalidValue(definition, "expected a referenced record ID.");
    if (references.length > 100) {
      return invalidValue(definition, "must contain at most 100 references.");
    }
    if (new Set(references).size !== references.length) {
      return invalidValue(definition, "referenced record IDs must be unique.");
    }
    if (references.some((reference) => !uuidPattern.test(reference))) {
      return invalidValue(definition, "expected stable UUID record IDs.");
    }
    return definition.referenceMultiple ? references : references[0];
  }

  if (typeof value !== "string") {
    return invalidValue(definition, "expected text.");
  }
  const maximumLength = definition.fieldType === "textarea" ? 20_000 : 2_048;
  if (value.length > maximumLength) {
    return invalidValue(definition, `must not exceed ${maximumLength} characters.`);
  }
  if (definition.fieldType === "date" && !validCalendarDate(value)) {
    return invalidValue(definition, "expected a calendar date in YYYY-MM-DD format.");
  }
  if (definition.fieldType === "datetime") {
    const parsed = new Date(value);
    if (!value.includes("T") || Number.isNaN(parsed.getTime())) {
      return invalidValue(definition, "expected an ISO 8601 date and time.");
    }
    return parsed.toISOString();
  }
  if (definition.fieldType === "select") {
    if (!definition.options.some((option) => option.value === value)) {
      return invalidValue(definition, "must use one of the configured options.");
    }
  }
  if (definition.fieldType === "email") {
    if (
      value.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ) {
      return invalidValue(definition, "expected a valid email address.");
    }
  }
  if (definition.fieldType === "url") {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      return invalidValue(definition, "expected an absolute HTTP or HTTPS URL.");
    }
  }
  return value;
};

const normalizedFilter = (value: string) => value.trim().toLowerCase();

const categoryCondition = (column: typeof resources.categories, categories: string[]) => {
  if (!categories.length) return undefined;
  const normalized = categories.map(normalizedFilter);
  return sql`exists (
    select 1
    from jsonb_array_elements(${column}) as custom_field_category
    where lower(custom_field_category ->> 'name') in (${sql.join(
      normalized.map((category) => sql`${category}`),
      sql`, `,
    )})
  )`;
};

const normalizedListCondition = (
  column: typeof resources.status | typeof stockUnits.status,
  values: string[],
) =>
  sql`lower(${column}) in (${sql.join(
    values.map((value) => sql`${normalizedFilter(value)}`),
    sql`, `,
  )})`;

async function queryReferenceOptions(options: {
  definition: CustomFieldDefinition;
  query?: string;
  ids?: string[];
  applyFilters: boolean;
  limit: number;
  executor: CustomFieldQueryExecutor;
}): Promise<CustomFieldReferenceOption[]> {
  const { definition, executor } = options;
  const query = options.query?.trim();
  if (definition.referenceEntityType === "inventory") {
    const conditions: SQL[] = [];
    if (options.ids?.length) conditions.push(inArray(resources.id, options.ids));
    if (options.applyFilters) {
      if (definition.referenceResourceTypes.length) {
        conditions.push(inArray(resources.type, definition.referenceResourceTypes));
      }
      if (definition.referenceStatuses.length) {
        conditions.push(
          normalizedListCondition(resources.status, definition.referenceStatuses),
        );
      }
      const categories = categoryCondition(
        resources.categories,
        definition.referenceCategories,
      );
      if (categories) conditions.push(categories);
    }
    if (query) {
      const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const queryCondition = or(
        ilike(resources.name, pattern),
        ilike(resources.sku, pattern),
        sql`${resources.id}::text ilike ${pattern}`,
      );
      if (queryCondition) conditions.push(queryCondition);
    }
    const rows = await executor
      .select({
        id: resources.id,
        name: resources.name,
        sku: resources.sku,
        type: resources.type,
        status: resources.status,
      })
      .from(resources)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(resources.name), asc(resources.id))
      .limit(options.limit);
    return rows.map((row) => ({
      id: row.id,
      entityType: "inventory" as const,
      label: row.name,
      description: [row.sku, row.type, row.status].filter(Boolean).join(" · "),
      status: row.status,
    }));
  }

  if (definition.referenceEntityType === "stock_unit") {
    const conditions: SQL[] = [];
    if (options.ids?.length) conditions.push(inArray(stockUnits.id, options.ids));
    if (options.applyFilters) {
      if (definition.referenceResourceTypes.length) {
        conditions.push(inArray(resources.type, definition.referenceResourceTypes));
      }
      if (definition.referenceStatuses.length) {
        conditions.push(
          normalizedListCondition(stockUnits.status, definition.referenceStatuses),
        );
      }
      const categories = categoryCondition(
        resources.categories,
        definition.referenceCategories,
      );
      if (categories) conditions.push(categories);
    }
    if (query) {
      const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const queryCondition = or(
        ilike(stockUnits.code, pattern),
        ilike(resources.name, pattern),
        ilike(resources.sku, pattern),
        sql`${stockUnits.id}::text ilike ${pattern}`,
      );
      if (queryCondition) conditions.push(queryCondition);
    }
    const rows = await executor
      .select({
        id: stockUnits.id,
        code: stockUnits.code,
        status: stockUnits.status,
        resourceName: resources.name,
        resourceType: resources.type,
        sku: resources.sku,
      })
      .from(stockUnits)
      .innerJoin(resources, eq(stockUnits.resourceId, resources.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(resources.name), asc(stockUnits.code), asc(stockUnits.id))
      .limit(options.limit);
    return rows.map((row) => ({
      id: row.id,
      entityType: "stock_unit" as const,
      label: `${row.resourceName} · ${row.code}`,
      description: [row.sku, row.resourceType, row.status].filter(Boolean).join(" · "),
      status: row.status,
    }));
  }

  return [];
}

export async function listCustomFieldReferenceOptions(options: {
  definitionId: string;
  query?: string;
  selectedIds?: string[];
  limit?: number;
  executor?: CustomFieldQueryExecutor;
}) {
  const executor = options.executor ?? db;
  const [row] = await executor
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.id, options.definitionId),
        isNull(customFieldDefinitions.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw new CustomFieldError("Custom field definition not found.", 404);
  const definition = definitionDto(row);
  if (definition.fieldType !== "reference" || !definition.referenceEntityType) {
    throw new CustomFieldError("This custom field is not a reference field.", 422);
  }

  const selectedIds = [...new Set(options.selectedIds ?? [])];
  if (selectedIds.some((id) => !uuidPattern.test(id))) {
    throw new CustomFieldError("Reference option IDs must be UUIDs.", 422);
  }
  if (selectedIds.length > 100) {
    throw new CustomFieldError("Resolve at most 100 selected references at a time.", 422);
  }
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
  const [selected, matches] = await Promise.all([
    selectedIds.length
      ? queryReferenceOptions({
          definition,
          ids: selectedIds,
          applyFilters: false,
          limit: selectedIds.length,
          executor,
        })
      : Promise.resolve([]),
    queryReferenceOptions({
      definition,
      query: options.query,
      applyFilters: true,
      limit,
      executor,
    }),
  ]);
  const result = new Map<string, CustomFieldReferenceOption>();
  for (const option of [...selected, ...matches]) result.set(option.id, option);
  return { definition, options: [...result.values()].slice(0, selected.length + limit) };
}

async function validateReferenceValue(options: {
  definition: CustomFieldDefinition;
  value: CustomFieldValue;
  currentValue?: CustomFieldValue;
  executor: CustomFieldQueryExecutor;
}) {
  if (options.definition.fieldType !== "reference") return;
  const references: string[] = Array.isArray(options.value)
    ? options.value
    : typeof options.value === "string"
      ? [options.value]
      : [];
  const currentReferences = new Set(
    Array.isArray(options.currentValue)
      ? options.currentValue
      : typeof options.currentValue === "string"
        ? [options.currentValue]
        : [],
  );
  const added = references.filter((reference) => !currentReferences.has(reference));
  if (!added.length) return;
  const matches = await queryReferenceOptions({
    definition: options.definition,
    ids: added,
    applyFilters: true,
    limit: added.length,
    executor: options.executor,
  });
  const matchedIds = new Set(matches.map((match) => match.id));
  if (added.some((reference) => !matchedIds.has(reference))) {
    return invalidValue(
      options.definition,
      "a referenced record does not exist or does not match the configured filters.",
    );
  }
}

const sameJsonValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export async function validateCustomFieldValues(options: {
  entityType: CustomFieldEntityType;
  target: CustomFieldTarget;
  values: CustomFieldValues;
  currentValues?: CustomFieldValues;
  enforceRequired?: boolean;
  executor?: CustomFieldQueryExecutor;
}) {
  const definitions = (
    await listCustomFieldDefinitions({
      entityType: options.entityType,
      executor: options.executor,
    })
  ).filter((definition) =>
    isCustomFieldDefinitionApplicable(definition, options.target),
  );
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const result: CustomFieldValues = {};

  for (const [key, value] of Object.entries(options.values)) {
    const definition = byKey.get(key);
    if (!definition) {
      if (
        options.currentValues &&
        Object.hasOwn(options.currentValues, key) &&
        sameJsonValue(options.currentValues[key], value)
      ) {
        result[key] = value;
        continue;
      }
      throw new CustomFieldError(
        `Custom field ${key} is not configured for this item.`,
        422,
        { field: key },
      );
    }
    const validated = validateValue(definition, value);
    await validateReferenceValue({
      definition,
      value: validated,
      currentValue: options.currentValues?.[key],
      executor: options.executor ?? db,
    });
    result[key] = validated;
  }

  // Archived or no-longer-applicable values remain stored but cannot be
  // changed through the typed API. This makes definition changes non-lossy.
  for (const [key, value] of Object.entries(options.currentValues ?? {})) {
    if (!byKey.has(key)) result[key] = value;
  }

  for (const definition of definitions) {
    if (
      options.enforceRequired !== false &&
      definition.required &&
      !hasValue(result[definition.key])
    ) {
      throw new CustomFieldError(
        `Custom field ${definition.label} is required.`,
        422,
        { field: definition.key, fieldType: definition.fieldType },
      );
    }
  }
  if (Object.keys(result).length > 100 || JSON.stringify(result).length > 50_000) {
    throw new CustomFieldError(
      "Custom field values must contain at most 100 fields and be 50 KB or smaller.",
      422,
    );
  }
  return result;
}
