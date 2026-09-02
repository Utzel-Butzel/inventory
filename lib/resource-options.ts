import "server-only";

import { createHash } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import {
  bomLines,
  resourceOptionConfigurations,
  resourceOptionGroups,
  resourceOptionSelections,
  resourceOptionValues,
  resourceRelations,
  resources,
  stockSettings,
  variantBomOverrides,
  type ResourceRecord,
} from "@/db/schema";
import {
  AssemblyOperationError,
  assertCurrentEffectiveBomGraphAcyclic,
} from "@/lib/assemblies";
import { db } from "@/lib/db";
import {
  BOM_WRITE_LOCK_ID,
  VARIANT_FAMILY_WRITE_LOCK_ID,
} from "@/lib/inventory-locks";
import { VARIANT_RELATION_TYPE } from "@/lib/resource-families";
import { enqueueWebhookEvent } from "@/lib/webhooks";

const MAX_GROUPS = 4;
const MAX_VALUES_PER_GROUP = 8;
export const MAX_OPTION_COMBINATIONS = 100;

export type ResourceOptionValueInput = {
  label: string;
  code: string;
  componentResourceId: string | null;
  isDefault: boolean;
  position: number;
};

export type ResourceOptionGroupInput = {
  key: string;
  name: string;
  bomSlotKey: string | null;
  position: number;
  values: ResourceOptionValueInput[];
};

export class ResourceOptionsError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "ResourceOptionsError";
  }
}

export function resourceOptionsHttpError(error: unknown, fallback: string) {
  if (error instanceof ResourceOptionsError) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof AssemblyOperationError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("resources_sku_unique")) {
    return {
      status: 409 as const,
      message: "One of the generated SKUs is already in use.",
    };
  }
  return { status: 500 as const, message: fallback };
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type StoredGroup = typeof resourceOptionGroups.$inferSelect & {
  values: Array<
    typeof resourceOptionValues.$inferSelect & { componentName: string | null }
  >;
};

type ValidatedDefinitions = {
  groups: ResourceOptionGroupInput[];
  baseBySlot: Map<string, typeof bomLines.$inferSelect>;
  combinationCount: number;
};

const signatureFor = (
  choices: Array<{ group: { key: string }; value: { code: string } }>,
) => choices.map(({ group, value }) => `${group.key}:${value.code}`).join("|");

const generatedSku = (primarySku: string | null, codes: string[]) => {
  if (!primarySku) return null;
  const suffix = codes.join("-");
  const candidate = `${primarySku}-${suffix}`;
  if (candidate.length <= 80) return candidate;
  const digest = createHash("sha256").update(candidate).digest("hex").slice(0, 10);
  return `${primarySku.slice(0, Math.max(1, 69))}-${digest}`;
};

const generatedName = (primaryName: string, labels: string[]) => {
  const suffix = labels.join(" / ");
  const candidate = `${primaryName} – ${suffix}`;
  if (candidate.length <= 240) return candidate;
  const digest = createHash("sha256").update(candidate).digest("hex").slice(0, 8);
  return `${primaryName.slice(0, Math.max(1, 228))} – ${digest}`;
};

async function findPrimaryId(
  transaction: Pick<typeof db, "select">,
  organizationId: string,
  resourceId: string,
) {
  const [membership] = await transaction
    .select({ primaryResourceId: resourceRelations.targetResourceId })
    .from(resourceRelations)
    .where(
      and(
        eq(resourceRelations.organizationId, organizationId),
        eq(resourceRelations.sourceResourceId, resourceId),
        eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
      ),
    )
    .limit(1);
  return membership?.primaryResourceId ?? resourceId;
}

async function readStoredGroups(
  transaction: Pick<typeof db, "select">,
  organizationId: string,
  primaryResourceId: string,
): Promise<StoredGroup[]> {
  const groupRows = await transaction
    .select()
    .from(resourceOptionGroups)
    .where(
      and(
        eq(resourceOptionGroups.organizationId, organizationId),
        eq(resourceOptionGroups.primaryResourceId, primaryResourceId),
      ),
    )
    .orderBy(asc(resourceOptionGroups.position), asc(resourceOptionGroups.id));
  const groupIds = groupRows.map((group) => group.id);
  const valueRows = groupIds.length
    ? await transaction
        .select()
        .from(resourceOptionValues)
        .where(
          and(
            eq(resourceOptionValues.organizationId, organizationId),
            inArray(resourceOptionValues.groupId, groupIds),
          ),
        )
        .orderBy(asc(resourceOptionValues.position), asc(resourceOptionValues.id))
    : [];
  const relevantValues = valueRows;
  const componentIds = Array.from(
    new Set(
      relevantValues.flatMap((value) =>
        value.componentResourceId ? [value.componentResourceId] : [],
      ),
    ),
  );
  const componentRows = componentIds.length
    ? await transaction
        .select({ id: resources.id, name: resources.name })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, componentIds),
          ),
        )
    : [];
  const componentNames = new Map(componentRows.map((row) => [row.id, row.name]));
  return groupRows.map((group) => ({
    ...group,
    values: relevantValues
      .filter((value) => value.groupId === group.id)
      .map((value) => ({
        ...value,
        componentName: value.componentResourceId
          ? componentNames.get(value.componentResourceId) ?? null
          : null,
      })),
  }));
}

async function validateDefinitions(
  transaction: Transaction,
  organizationId: string,
  primaryResourceId: string,
  rawGroups: ResourceOptionGroupInput[],
): Promise<ValidatedDefinitions> {
  if (rawGroups.length > MAX_GROUPS) {
    throw new ResourceOptionsError(
      `Use no more than ${MAX_GROUPS} option groups.`,
      422,
    );
  }
  const groups = rawGroups.map((group, groupPosition) => ({
    key: group.key.trim().toLowerCase(),
    name: group.name.trim(),
    bomSlotKey: group.bomSlotKey?.trim() || null,
    position: groupPosition,
    values: group.values.map((value, valuePosition) => ({
      label: value.label.trim(),
      code: value.code.trim().toUpperCase(),
      componentResourceId: value.componentResourceId || null,
      isDefault: value.isDefault,
      position: valuePosition,
    })),
  }));
  const keys = groups.map((group) => group.key);
  if (new Set(keys).size !== keys.length) {
    throw new ResourceOptionsError("Option group keys must be unique.", 422);
  }
  const slots = groups.flatMap((group) =>
    group.bomSlotKey ? [group.bomSlotKey] : [],
  );
  if (new Set(slots).size !== slots.length) {
    throw new ResourceOptionsError(
      "A BOM slot can be controlled by only one option group.",
      422,
    );
  }
  let combinationCount = groups.length ? 1 : 0;
  for (const group of groups) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(group.key) || !group.name) {
      throw new ResourceOptionsError("Each option group needs a valid key and name.", 422);
    }
    if (group.values.length < 2 || group.values.length > MAX_VALUES_PER_GROUP) {
      throw new ResourceOptionsError(
        `Each option group needs between 2 and ${MAX_VALUES_PER_GROUP} values.`,
        422,
      );
    }
    if (group.values.filter((value) => value.isDefault).length !== 1) {
      throw new ResourceOptionsError(
        `Option group "${group.name}" needs exactly one default value.`,
        422,
      );
    }
    const codes = group.values.map((value) => value.code);
    const labels = group.values.map((value) => value.label.toLocaleLowerCase());
    if (
      new Set(codes).size !== codes.length ||
      new Set(labels).size !== labels.length ||
      group.values.some(
        (value) =>
          !value.label || !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(value.code),
      )
    ) {
      throw new ResourceOptionsError(
        `Option values in "${group.name}" need unique labels and codes.`,
        422,
      );
    }
    if (group.bomSlotKey) {
      if (group.values.some((value) => !value.componentResourceId)) {
        throw new ResourceOptionsError(
          `Every value in BOM-mapped group "${group.name}" needs a component.`,
          422,
        );
      }
    } else if (group.values.some((value) => value.componentResourceId)) {
      throw new ResourceOptionsError(
        `Option group "${group.name}" must select a BOM slot before assigning components.`,
        422,
      );
    }
    combinationCount *= group.values.length;
  }
  if (combinationCount > MAX_OPTION_COMBINATIONS) {
    throw new ResourceOptionsError(
      `This matrix creates ${combinationCount} combinations. The limit is ${MAX_OPTION_COMBINATIONS}.`,
      422,
    );
  }

  const baseLines = await transaction
    .select()
    .from(bomLines)
    .where(
      and(
        eq(bomLines.organizationId, organizationId),
        eq(bomLines.assemblyResourceId, primaryResourceId),
      ),
    );
  const baseBySlot = new Map(baseLines.map((line) => [line.slotKey, line]));
  for (const group of groups) {
    if (!group.bomSlotKey) continue;
    const base = baseBySlot.get(group.bomSlotKey);
    if (!base) {
      throw new ResourceOptionsError(
        `The BOM slot selected by option group "${group.name}" no longer exists.`,
        422,
      );
    }
    const defaultValue = group.values.find((value) => value.isDefault)!;
    if (defaultValue.componentResourceId !== base.componentResourceId) {
      throw new ResourceOptionsError(
        `The default component in option group "${group.name}" must match the primary BOM.`,
        422,
      );
    }
  }
  const componentIds = Array.from(
    new Set(
      groups.flatMap((group) =>
        group.values.flatMap((value) =>
          value.componentResourceId ? [value.componentResourceId] : [],
        ),
      ),
    ),
  );
  if (componentIds.includes(primaryResourceId)) {
    throw new ResourceOptionsError(
      "The primary item cannot be one of its own option components.",
      422,
    );
  }
  if (componentIds.length) {
    const existing = await transaction
      .select({ id: resources.id })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          inArray(resources.id, componentIds),
        ),
      );
    if (existing.length !== componentIds.length) {
      throw new ResourceOptionsError(
        "One or more option components no longer exist.",
        422,
      );
    }
  }
  return { groups, baseBySlot, combinationCount };
}

export async function getResourceOptions(
  organizationId: string,
  currentResourceId: string,
  options: {
    authorize?: (resource: ResourceRecord) => boolean | Promise<boolean>;
  } = {},
) {
  const [current] = await db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, currentResourceId),
      ),
    )
    .limit(1);
  if (!current) return null;
  const primaryResourceId = await findPrimaryId(
    db,
    organizationId,
    currentResourceId,
  );
  const [primary] =
    primaryResourceId === currentResourceId
      ? [current]
      : await db
          .select()
          .from(resources)
          .where(
            and(
              eq(resources.organizationId, organizationId),
              eq(resources.id, primaryResourceId),
            ),
          )
          .limit(1);
  if (!primary) {
    throw new ResourceOptionsError("The primary inventory item was not found.", 404);
  }
  if (options.authorize) {
    const [currentAllowed, primaryAllowed] = await Promise.all([
      options.authorize(current),
      options.authorize(primary),
    ]);
    if (!currentAllowed || !primaryAllowed) {
      throw new ResourceOptionsError(
        "You do not have permission to view this option family.",
        403,
      );
    }
  }

  const [groups, storedConfigurations, variantCountRows, slotRows] = await Promise.all([
    readStoredGroups(db, organizationId, primary.id),
    db
      .select()
      .from(resourceOptionConfigurations)
      .where(
        and(
          eq(resourceOptionConfigurations.organizationId, organizationId),
          eq(resourceOptionConfigurations.primaryResourceId, primary.id),
        ),
      ),
    db
      .select({ value: count() })
      .from(resourceRelations)
      .where(
        and(
          eq(resourceRelations.organizationId, organizationId),
          eq(resourceRelations.targetResourceId, primary.id),
          eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
        ),
      ),
    db
      .select({
        slotKey: bomLines.slotKey,
        position: bomLines.position,
        componentResourceId: bomLines.componentResourceId,
        componentName: resources.name,
      })
      .from(bomLines)
      .innerJoin(
        resources,
        and(
          eq(resources.organizationId, bomLines.organizationId),
          eq(resources.id, bomLines.componentResourceId),
        ),
      )
      .where(
        and(
          eq(bomLines.organizationId, organizationId),
          eq(bomLines.assemblyResourceId, primary.id),
        ),
      )
      .orderBy(asc(bomLines.position), asc(bomLines.slotKey)),
  ]);
  const configurationResourceIds = storedConfigurations.map(
    (configuration) => configuration.resourceId,
  );
  const configurationResources = configurationResourceIds.length
    ? await db
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, configurationResourceIds),
          ),
        )
    : [];
  const configurationResourceById = new Map(
    configurationResources.map((resource) => [resource.id, resource]),
  );
  const configurationAccess = options.authorize
    ? await Promise.all(
        configurationResources.map(async (resource) => [
          resource.id,
          resource.id === current.id || resource.id === primary.id
            ? true
            : await options.authorize!(resource),
        ] as const),
      )
    : configurationResources.map((resource) => [resource.id, true] as const);
  const accessibleResourceIds = new Set(
    configurationAccess
      .filter(([, allowed]) => allowed)
      .map(([resourceId]) => resourceId),
  );
  const accessibleConfigurations = storedConfigurations.filter(
    (configuration) => accessibleResourceIds.has(configuration.resourceId),
  );
  const accessibleConfigurationIds = accessibleConfigurations.map(
    (configuration) => configuration.id,
  );
  const selections = accessibleConfigurationIds.length
    ? await db
        .select({
          configurationId: resourceOptionSelections.configurationId,
          groupId: resourceOptionSelections.groupId,
          valueId: resourceOptionSelections.valueId,
        })
        .from(resourceOptionSelections)
        .where(
          and(
            eq(resourceOptionSelections.organizationId, organizationId),
            inArray(
              resourceOptionSelections.configurationId,
              accessibleConfigurationIds,
            ),
          ),
        )
    : [];
  const currentConfiguration = accessibleConfigurations.find(
    (configuration) => configuration.resourceId === currentResourceId,
  );
  const selectionByGroup = new Map(
    selections
      .filter(
        (selection) => selection.configurationId === currentConfiguration?.id,
      )
      .map((selection) => [selection.groupId, selection.valueId]),
  );
  const combinationCount = groups.length
    ? groups.reduce((total, group) => total * group.values.length, 1)
    : 0;
  const generatedVariantCount = storedConfigurations.filter(
    (configuration) => configuration.resourceId !== primary.id,
  ).length;
  const configurationDtos = accessibleConfigurations
    .flatMap((configuration) => {
      const resource = configurationResourceById.get(configuration.resourceId);
      if (!resource) return [];
      const selectedValueByGroup = new Map(
        selections
          .filter(
            (selection) => selection.configurationId === configuration.id,
          )
          .map((selection) => [selection.groupId, selection.valueId]),
      );
      return [{
        resourceId: resource.id,
        resourceName: resource.name,
        resourceSku: resource.sku,
        isPrimary: resource.id === primary.id,
        signature: configuration.signature,
        selection: groups.flatMap((group) => {
          const valueId = selectedValueByGroup.get(group.id);
          const value = group.values.find((candidate) => candidate.id === valueId);
          return value
            ? [{
                groupId: group.id,
                groupName: group.name,
                valueId: value.id,
                valueLabel: value.label,
              }]
            : [];
        }),
      }];
    })
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      return left.resourceName.localeCompare(right.resourceName);
    });

  return {
    role: currentResourceId === primary.id ? ("primary" as const) : ("variant" as const),
    currentResourceId,
    primary: { id: primary.id, name: primary.name, sku: primary.sku },
    groups: groups.map((group) => ({
      id: group.id,
      key: group.key,
      name: group.name,
      bomSlotKey: group.bomSlotKey,
      position: group.position,
      values: group.values.map((value) => ({
        id: value.id,
        label: value.label,
        code: value.code,
        componentResourceId: value.componentResourceId,
        componentName: value.componentName,
        isDefault: value.isDefault,
        position: value.position,
      })),
    })),
    configurations: configurationDtos,
    currentSelection: groups.flatMap((group) => {
      const selectedId = selectionByGroup.get(group.id);
      const value = selectedId
        ? group.values.find((candidate) => candidate.id === selectedId)
        : group.values.find((candidate) => candidate.isDefault);
      return value
        ? [{ groupId: group.id, groupName: group.name, valueId: value.id, valueLabel: value.label }]
        : [];
    }),
    bomSlots: slotRows,
    combinationCount,
    generatedVariantCount,
    familyVariantCount: Number(variantCountRows[0]?.value ?? 0),
    definitionsLocked: storedConfigurations.length > 0,
  };
}

export async function replaceResourceOptionGroups(options: {
  organizationId: string;
  primaryResourceId: string;
  groups: ResourceOptionGroupInput[];
  actor: string;
}) {
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
    );
    const [primary] = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, options.organizationId),
          eq(resources.id, options.primaryResourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!primary) throw new ResourceOptionsError("Not found", 404);
    const [outgoing, incoming, generated] = await Promise.all([
      transaction
        .select({ id: resourceRelations.id })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, options.organizationId),
            eq(resourceRelations.sourceResourceId, primary.id),
            eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
          ),
        )
        .limit(1),
      transaction
        .select({ id: resourceRelations.id })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, options.organizationId),
            eq(resourceRelations.targetResourceId, primary.id),
            eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
          ),
        )
        .limit(1),
      transaction
        .select({ id: resourceOptionConfigurations.id })
        .from(resourceOptionConfigurations)
        .where(
          and(
            eq(resourceOptionConfigurations.organizationId, options.organizationId),
            eq(resourceOptionConfigurations.primaryResourceId, primary.id),
          ),
        )
        .limit(1),
    ]);
    if (outgoing.length) {
      throw new ResourceOptionsError("Edit option groups on the primary item.", 409);
    }
    if (generated.length) {
      throw new ResourceOptionsError(
        "Option definitions are locked after variants have been generated.",
        409,
      );
    }
    if (incoming.length && options.groups.length) {
      throw new ResourceOptionsError(
        "This family already has manually created variants. Remove or detach them before configuring an option matrix.",
        409,
      );
    }
    const validated = await validateDefinitions(
      transaction,
      options.organizationId,
      primary.id,
      options.groups,
    );
    await transaction
      .delete(resourceOptionGroups)
      .where(
        and(
          eq(resourceOptionGroups.organizationId, options.organizationId),
          eq(resourceOptionGroups.primaryResourceId, primary.id),
        ),
      );
    const now = new Date();
    for (const group of validated.groups) {
      const [createdGroup] = await transaction
        .insert(resourceOptionGroups)
        .values({
          organizationId: options.organizationId,
          primaryResourceId: primary.id,
          key: group.key,
          name: group.name,
          bomSlotKey: group.bomSlotKey,
          position: group.position,
          createdBy: options.actor,
          updatedBy: options.actor,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: resourceOptionGroups.id });
      await transaction.insert(resourceOptionValues).values(
        group.values.map((value) => ({
          organizationId: options.organizationId,
          groupId: createdGroup.id,
          label: value.label,
          code: value.code,
          componentResourceId: value.componentResourceId,
          isDefault: value.isDefault,
          position: value.position,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    const [saved] = await transaction
      .update(resources)
      .set({ updatedAt: now })
      .where(
        and(
          eq(resources.organizationId, options.organizationId),
          eq(resources.id, primary.id),
        ),
      )
      .returning();
    await enqueueWebhookEvent(transaction, {
      organizationId: options.organizationId,
      type: "inventory.resource.updated",
      aggregateType: "resource",
      aggregateId: primary.id,
      actor: options.actor,
      data: { resource: saved, changedFields: ["optionGroups"] },
    });
  });
  const result = await getResourceOptions(
    options.organizationId,
    options.primaryResourceId,
  );
  if (!result) throw new ResourceOptionsError("Not found", 404);
  return result;
}

type Choice = {
  group: StoredGroup;
  value: StoredGroup["values"][number];
};

const cartesianChoices = (groups: StoredGroup[]) =>
  groups.reduce<Choice[][]>(
    (combinations, group) =>
      combinations.flatMap((combination) =>
        group.values.map((value) => [...combination, { group, value }]),
      ),
    [[]],
  );

async function insertConfiguration(
  transaction: Transaction,
  organizationId: string,
  primaryResourceId: string,
  resourceId: string,
  choices: Choice[],
  createdAt: Date,
) {
  const [configuration] = await transaction
    .insert(resourceOptionConfigurations)
    .values({
      organizationId,
      primaryResourceId,
      resourceId,
      signature: signatureFor(choices),
      createdAt,
    })
    .returning({ id: resourceOptionConfigurations.id });
  await transaction.insert(resourceOptionSelections).values(
    choices.map(({ group, value }) => ({
      organizationId,
      configurationId: configuration.id,
      groupId: group.id,
      valueId: value.id,
      createdAt,
    })),
  );
}

export async function generateResourceOptionVariants(options: {
  organizationId: string;
  primaryResourceId: string;
  actor: string;
  authorizeCreated?: (resource: ResourceRecord) => boolean | Promise<boolean>;
}) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
    );
    const [primary] = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, options.organizationId),
          eq(resources.id, options.primaryResourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!primary) throw new ResourceOptionsError("Not found", 404);
    if (primary.status === "archived") {
      throw new ResourceOptionsError(
        "Restore the primary inventory item before generating variants.",
        409,
      );
    }
    const [outgoing, incoming, existingConfiguration] = await Promise.all([
      transaction
        .select({ id: resourceRelations.id })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, options.organizationId),
            eq(resourceRelations.sourceResourceId, primary.id),
            eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
          ),
        )
        .limit(1),
      transaction
        .select({ id: resourceRelations.id })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, options.organizationId),
            eq(resourceRelations.targetResourceId, primary.id),
            eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
          ),
        )
        .limit(1),
      transaction
        .select({ id: resourceOptionConfigurations.id })
        .from(resourceOptionConfigurations)
        .where(
          and(
            eq(resourceOptionConfigurations.organizationId, options.organizationId),
            eq(resourceOptionConfigurations.primaryResourceId, primary.id),
          ),
        )
        .limit(1),
    ]);
    if (outgoing.length) {
      throw new ResourceOptionsError("Generate options from the primary item.", 409);
    }
    if (incoming.length) {
      throw new ResourceOptionsError(
        "This family already has variants. Option generation can only start from a family without variants.",
        409,
      );
    }
    if (existingConfiguration.length) {
      throw new ResourceOptionsError("These option variants were already generated.", 409);
    }
    const groups = await readStoredGroups(
      transaction,
      options.organizationId,
      primary.id,
    );
    if (!groups.length) {
      throw new ResourceOptionsError("Configure at least one option group first.", 409);
    }
    const validated = await validateDefinitions(
      transaction,
      options.organizationId,
      primary.id,
      groups.map((group) => ({
        key: group.key,
        name: group.name,
        bomSlotKey: group.bomSlotKey,
        position: group.position,
        values: group.values.map((value) => ({
          label: value.label,
          code: value.code,
          componentResourceId: value.componentResourceId,
          isDefault: value.isDefault,
          position: value.position,
        })),
      })),
    );
    if (validated.combinationCount < 2) {
      throw new ResourceOptionsError("The option matrix has no variants to generate.", 409);
    }
    const [primarySettings] = await transaction
      .select()
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, options.organizationId),
          eq(stockSettings.resourceId, primary.id),
        ),
      )
      .limit(1);
    const combinations = cartesianChoices(groups);
    const defaultChoices = groups.map((group) => ({
      group,
      value: group.values.find((value) => value.isDefault)!,
    }));
    const now = new Date();
    await insertConfiguration(
      transaction,
      options.organizationId,
      primary.id,
      primary.id,
      defaultChoices,
      now,
    );
    const createdResources: ResourceRecord[] = [];
    for (const choices of combinations) {
      if (choices.every(({ value }) => value.isDefault)) continue;
      const labels = choices.map(({ value }) => value.label);
      const codes = choices.map(({ value }) => value.code);
      const [created] = await transaction
        .insert(resources)
        .values({
          organizationId: options.organizationId,
          name: generatedName(primary.name, labels),
          description: primary.description,
          type: primary.type,
          status: "available",
          sku: generatedSku(primary.sku, codes),
          quantity: 0,
          location: null,
          serialNumber: null,
          barcode: null,
          valueCents: primary.valueCents,
          currency: primary.currency,
          priority: primary.priority,
          tags: primary.tags,
          categories: primary.categories,
          customFields: primary.customFields,
          relatedResourceIds: [],
          mapFeatures: [],
          notes: primary.notes,
          createdBy: options.actor,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (options.authorizeCreated && !(await options.authorizeCreated(created))) {
        throw new ResourceOptionsError(
          "One generated variant would fall outside the inventory rule that grants your access.",
          403,
        );
      }
      await transaction
        .update(stockSettings)
        .set({
          trackingMode: primarySettings?.trackingMode ?? "bulk",
          minimumStock: primarySettings?.minimumStock ?? 0,
          reorderQuantity: primarySettings?.reorderQuantity ?? 0,
          leadTimeDays: primarySettings?.leadTimeDays ?? 0,
          unitName: primarySettings?.unitName ?? "unit",
          purchaseUnitName: primarySettings?.purchaseUnitName ?? null,
          purchaseUnitFactor: primarySettings?.purchaseUnitFactor ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(stockSettings.organizationId, options.organizationId),
            eq(stockSettings.resourceId, created.id),
          ),
        );
      await transaction.insert(resourceRelations).values({
        organizationId: options.organizationId,
        sourceResourceId: created.id,
        targetResourceId: primary.id,
        relationTypeKey: VARIANT_RELATION_TYPE,
        origin: "manual",
        attributes: { overriddenFields: [], protected: true },
        createdBy: options.actor,
        createdAt: now,
      });
      await insertConfiguration(
        transaction,
        options.organizationId,
        primary.id,
        created.id,
        choices,
        now,
      );
      const overrides = choices.flatMap(({ group, value }) => {
        if (!group.bomSlotKey || !value.componentResourceId) return [];
        const base = validated.baseBySlot.get(group.bomSlotKey);
        if (!base || base.componentResourceId === value.componentResourceId) return [];
        return [{
          organizationId: options.organizationId,
          variantResourceId: created.id,
          slotKey: base.slotKey,
          componentResourceId: value.componentResourceId,
          quantityPerAssembly: base.quantityPerAssembly,
          position: base.position,
          note: base.note,
          removed: false,
          updatedAt: now,
        }];
      });
      if (overrides.length) {
        await transaction.insert(variantBomOverrides).values(overrides);
      }
      await enqueueWebhookEvent(transaction, {
        organizationId: options.organizationId,
        type: "inventory.resource.created",
        aggregateType: "resource",
        aggregateId: created.id,
        actor: options.actor,
        data: {
          resource: { ...created, media: [], cover: null },
          family: {
            role: "variant",
            primaryResourceId: primary.id,
            relationType: VARIANT_RELATION_TYPE,
          },
          options: choices.map(({ group, value }) => ({
            groupKey: group.key,
            valueCode: value.code,
          })),
        },
      });
      createdResources.push(created);
    }
    const graphProbe = createdResources.at(-1);
    if (graphProbe) {
      await assertCurrentEffectiveBomGraphAcyclic(
        transaction,
        options.organizationId,
        graphProbe.id,
      );
    }
    await enqueueWebhookEvent(transaction, {
      organizationId: options.organizationId,
      type: "inventory.resource.updated",
      aggregateType: "resource",
      aggregateId: primary.id,
      actor: options.actor,
      data: {
        resource: primary,
        changedFields: ["optionVariants"],
        generatedVariantCount: createdResources.length,
      },
    });
    return {
      primaryResourceId: primary.id,
      generatedVariantCount: createdResources.length,
      variants: createdResources.map((resource) => ({
        id: resource.id,
        name: resource.name,
        sku: resource.sku,
      })),
    };
  });
}
