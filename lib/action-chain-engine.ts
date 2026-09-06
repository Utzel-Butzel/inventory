import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { bomLines, variantBomOverrides, organizations, resourceRelations, resources, stockSettings, stockUnits, stockScanWorkflows, stockScanExecutions } from "@/db/schema";
import { db } from "@/lib/db";
import { buildAssembly } from "@/lib/assemblies";
import { createStockUnits, updateStockUnit, bookStockMovement } from "@/lib/stock";
import { enqueueWebhookEvent } from "@/lib/webhooks";
import { BOM_WRITE_LOCK_ID, VARIANT_FAMILY_WRITE_LOCK_ID } from "@/lib/inventory-locks";
import { actionConditionsSchema, matchesActionConditions, resolveActionValue, type ActionValue, type ChainAction, type ChainContext } from "@/lib/action-chain-contract";
import { scanWorkflowCreateSchema, type StockScanExecuteInput } from "@/lib/scan-workflow-contract";
import { extractScanIdentifier, getScanWorkflowTargetGroups, selectWorkflowTargetIds, resolveWorkflowValues, normalizeInputValue, ScanWorkflowError, assertPublicExecutionAccess } from "@/lib/scan-workflows";
import type { CustomFieldValues } from "@/lib/custom-field-contract";
import { scanCodeTypes } from "@/lib/scan-code-types";

export const chainRunInputSchema = z.object({
  workflowId: z.string().uuid(), code: z.string().trim().min(1).max(2048),
  codeType: z.enum(scanCodeTypes).nullable().optional(),
  selectedResourceIds: z.array(z.string().uuid()).max(24).default([]),
  inputs: z.record(z.string().max(80), z.union([z.string().max(20_000), z.number().finite(), z.boolean(), z.array(z.string().max(2048)).max(12)])).default({}),
  expectedPlanHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type ChainRunInput = z.infer<typeof chainRunInputSchema>;
export type ChainStepReport = {
  id: string; label: string; type: string; skipped: boolean; target: string | null;
  eventName?: string;
  code?: string; quantityBefore?: number; quantityAfter?: number;
  statusBefore?: string | null; statusAfter?: string | null;
  locationBefore?: string | null; locationAfter?: string | null;
  metadata?: Record<string, unknown>; customFields?: CustomFieldValues;
  components?: Array<{ name: string; quantity: number; codes: string[] }>;
};
export type ChainRunReport = { workflowId: string; revision: number; identifier: string; planHash: string; steps: ChainStepReport[]; replayed?: boolean };
type Identity = { actor: string; publicTriggerId?: string; key?: string; requestHash?: string };
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
class PreviewRollback extends Error { constructor(readonly report: ChainRunReport) { super("Preview rollback"); } }
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function runActionChain(input: ChainRunInput, organizationId: string, identity: Identity, preview: boolean): Promise<ChainRunReport> {
  try {
    return await db.transaction(async (tx) => {
      // Use the same graph/resource lock order as manufacturing; all child services
      // share this connection through explicit executors and nested savepoints.
      await tx.execute(sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`);
      await tx.execute(sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`);
      const [organization] = await tx.select({ isReadOnly: organizations.isReadOnly }).from(organizations).where(eq(organizations.id, organizationId)).for("share");
      if (!organization || (!preview && organization.isReadOnly)) throw new ScanWorkflowError("Diese Organisation erlaubt keine Änderungen.", 409);
      const [workflow] = await tx.select().from(stockScanWorkflows).where(and(eq(stockScanWorkflows.organizationId, organizationId), eq(stockScanWorkflows.id, input.workflowId))).for("share");
      if (!workflow || !workflow.enabled) throw new ScanWorkflowError("Dieser Ablauf ist nicht verfügbar.", 404);
      assertPublicExecutionAccess(workflow, { key: identity.key ?? randomUUID(), requestHash: identity.requestHash ?? "", publicTriggerId: identity.publicTriggerId });
      if (!workflow.actions.length) throw new ScanWorkflowError("Dieser Ablauf enthält noch keine Aktionsliste.", 422);
      if (input.codeType && !workflow.codeTypes.includes(input.codeType as typeof workflow.codeTypes[number])) throw new ScanWorkflowError("Diese Code-Art ist für den Ablauf nicht erlaubt.", 422);
      const config = scanWorkflowCreateSchema.parse({ ...Object.fromEntries(Object.keys(scanWorkflowCreateSchema.shape).map((key) => [key, (workflow as unknown as Record<string, unknown>)[key]])) });
      const identifier = extractScanIdentifier(input.code, workflow.extraction);
      const groups = await getScanWorkflowTargetGroups(organizationId, workflow, tx);
      if (groups.length !== new Set(workflow.resourceIds.length ? workflow.resourceIds : [workflow.resourceId]).size) throw new ScanWorkflowError("Ein konfigurierter Zieleintrag ist nicht mehr verfügbar.", 409);
      const selectedIds = selectWorkflowTargetIds(workflow, groups, input.selectedResourceIds);
      const deduplicationKey = workflow.oncePerCode ? hash([workflow.id, identifier, [...selectedIds].sort()]) : null;
      const requestHash = identity.requestHash ?? hash([identity.actor, input]);
      if (!preview && !identity.key) throw new ScanWorkflowError("Ein Ausführungsschlüssel ist erforderlich.", 422);
      // Resource locking serializes retries, including callers supplying a new key.
      const locked = await tx.select({ id: resources.id, updatedAt: resources.updatedAt, quantity: resources.quantity }).from(resources).where(eq(resources.organizationId, organizationId)).orderBy(asc(resources.id)).for("update");
      if (identity.key) {
        const [previous] = await tx.select().from(stockScanExecutions).where(and(eq(stockScanExecutions.organizationId, organizationId), eq(stockScanExecutions.idempotencyKey, identity.key)));
        if (previous) {
          if (previous.requestHash !== requestHash || previous.actor !== identity.actor || previous.workflowId !== workflow.id) throw new ScanWorkflowError("Dieser Ausführungsschlüssel wurde bereits für andere Angaben verwendet.", 409);
          return { ...(previous.response as unknown as ChainRunReport), replayed: true };
        }
      }
      if (deduplicationKey) {
        const [previous] = await tx.select().from(stockScanExecutions).where(and(eq(stockScanExecutions.organizationId, organizationId), eq(stockScanExecutions.deduplicationKey, deduplicationKey)));
        if (previous) return { ...(previous.response as unknown as ChainRunReport), replayed: true };
      }
      const [unitVersions, recipes, memberships, settings, recipeOverrides] = await Promise.all([
        tx.select({ id: stockUnits.id, updatedAt: stockUnits.updatedAt }).from(stockUnits).where(eq(stockUnits.organizationId, organizationId)).orderBy(asc(stockUnits.id)),
        tx.select().from(bomLines).where(eq(bomLines.organizationId, organizationId)).orderBy(asc(bomLines.id)),
        tx.select().from(resourceRelations).where(eq(resourceRelations.organizationId, organizationId)).orderBy(asc(resourceRelations.id)),
        tx.select().from(stockSettings).where(eq(stockSettings.organizationId, organizationId)).orderBy(asc(stockSettings.resourceId)),
        tx.select().from(variantBomOverrides).where(eq(variantBomOverrides.organizationId, organizationId)).orderBy(asc(variantBomOverrides.id)),
      ]);
      const planHash = hash([workflow.id, workflow.revision, input.code, selectedIds, Object.entries(input.inputs).sort(([a], [b]) => a.localeCompare(b)), locked, unitVersions, recipes, memberships, settings, recipeOverrides]);
      if (!preview && input.expectedPlanHash !== planHash) throw new ScanWorkflowError("Bestand, Angaben oder Ablauf haben sich geändert. Prüfe die Vorschau erneut.", 409);
      const rawContext: ChainContext = { identifier, raw: input.code, inputs: input.inputs, results: {} };
      const normalizedInputs: Record<string, unknown> = {};
      for (const inputKey of Object.keys(input.inputs)) if (!workflow.inputFields.some((field) => field.key === inputKey)) throw new ScanWorkflowError(`Unbekannte Eingabe: ${inputKey}.`, 422);
      const visibleFields = [];
      for (const field of workflow.inputFields) {
        if (!matchesActionConditions(field.visibleWhen, { ...rawContext, inputs: normalizedInputs })) continue;
        visibleFields.push(field);
        const value = input.inputs[field.key];
        if (value === undefined || value === "" || value === null || (Array.isArray(value) && !value.length)) {
          if (field.required) throw new ScanWorkflowError(`Bitte „${field.label}“ ausfüllen.`, 422);
        } else normalizedInputs[field.key] = normalizeInputValue(field, value);
      }
      const sharedValues = resolveWorkflowValues({ ...workflow, inputFields: visibleFields }, identifier, input.code, normalizedInputs as StockScanExecuteInput["inputs"]);
      const steps: ChainStepReport[] = [];
      const pendingWebhooks: Array<{ action: Extract<ChainAction, { type: "webhook" }>; data: Record<string, unknown> }> = [];
      for (const selectedId of selectedIds) {
        const context: ChainContext = { ...rawContext, inputs: normalizedInputs, results: {} };
        for (const action of config.actions) {
          const report: ChainStepReport = { id: action.id, label: action.label, type: action.type, skipped: !action.enabled || !matchesActionConditions(action.when, context), target: null };
          steps.push(report);
          if (report.skipped) continue;
          try {
            if (action.type === "assert") {
              if (!matchesActionConditions(actionConditionsSchema.parse(action.check), context)) throw new ScanWorkflowError(action.message, 422);
              context.results[action.id] = { found: true };
              continue;
            }
            if (action.type === "webhook") {
              const data = Object.fromEntries(action.properties.map((property) => [property.key, requiredValue(property.value, context)]));
              report.eventName = action.eventName;
              report.metadata = data;
              pendingWebhooks.push({ action, data });
              context.results[action.id] = { found: true };
              continue;
            }
            const prior = action.target.source === "result" ? context.results[action.target.actionId] : undefined;
            const resourceId = action.target.source === "selected" ? selectedId : action.target.source === "resource" ? action.target.resourceId : String(prior?.resourceId ?? "");
            if (!z.string().uuid().safeParse(resourceId).success) throw new ScanWorkflowError("Das Ziel einer vorherigen Aktion ist nicht verfügbar.", 422);
            const [resource] = await tx.select().from(resources).where(and(eq(resources.organizationId, organizationId), eq(resources.id, resourceId)));
            if (!resource) throw new ScanWorkflowError("Der Zieleintrag ist nicht verfügbar.", 404);
            report.target = resource.name;
            report.quantityBefore = resource.quantity;
            let output: Record<string, unknown> = { resourceId, quantity: resource.quantity };
            if (action.type === "stock-adjustment") {
              const delta = integerValue(action.delta, context, -1_000_000, 1_000_000) * action.factor;
              if (!delta) throw new ScanWorkflowError("Die Bestandsänderung darf nicht null sein.", 422);
              const result = await bookStockMovement(organizationId, resourceId, { delta, quantity: Math.abs(delta), type: "scan-adjustment", reason: `${workflow.name}: ${action.label}` }, identity.actor, undefined, undefined, tx);
              output = { ...output, ...asRecord(result.response.resource), resourceId };
            } else {
              if (Number(prior?.unitCount ?? 0) > 1) throw new ScanWorkflowError("Diese Aktion benötigt eine einzelne Einheit. Die vorherige Montage erzeugt mehrere Geräte.", 422);
              const code = typeof prior?.code === "string" ? prior.code : String(requiredValue(action.code, context));
              if (!code.trim() || code.length > 180) throw new ScanWorkflowError("Die Einheitenkennung muss 1 bis 180 Zeichen lang sein.", 422);
              report.code = code;
              const [unit] = await tx.select().from(stockUnits).where(and(eq(stockUnits.organizationId, organizationId), eq(stockUnits.resourceId, resourceId), eq(stockUnits.code, code)));
              if (prior?.unitId && unit?.id !== prior.unitId) throw new ScanWorkflowError("Die Einheit aus der vorherigen Aktion passt nicht zum Ziel.", 409);
              report.statusBefore = unit?.status ?? null;
              if (action.type === "find-unit") {
                if (!unit && !action.allowMissing) throw new ScanWorkflowError(`Keine Einheit mit Kennung „${code}“ gefunden.`, 404);
                output = { ...output, found: Boolean(unit), unitId: unit?.id ?? null, code, status: unit?.status ?? null, metadata: unit?.metadata ?? {}, customFields: unit?.customFields ?? {} };
              } else if (action.type === "set-location") {
                if (!unit) throw new ScanWorkflowError("Die zu verschiebende Einheit wurde nicht gefunden.", 404);
                const rawLocation = requiredValue(action.location, context);
                const location = rawLocation === null || rawLocation === "" ? null : String(rawLocation);
                if (action.structured && location !== null && !z.string().uuid().safeParse(location).success) throw new ScanWorkflowError("Wähle einen gültigen Standort-Eintrag.", 422);
                const locationName = async (id: string | null, fallback: string | null) => id ? (await tx.select({ name: resources.name }).from(resources).where(and(eq(resources.organizationId, organizationId), eq(resources.id, id))))[0]?.name ?? fallback : fallback;
                report.locationBefore = await locationName(unit.locationResourceId, unit.location);
                const changed = await updateStockUnit(organizationId, resourceId, unit.id, action.structured ? { locationResourceId: location, location: null } : { location, locationResourceId: null }, identity.actor, tx);
                output = { ...changed.unit, unitId: changed.unit.id, resourceId, quantity: changed.resource.quantity };
                report.locationAfter = await locationName(changed.unit.locationResourceId, changed.unit.location);
              } else {
                const metadata: Record<string, unknown> = { ...(action.applyFlowValues ? sharedValues.metadata : {}) };
                const customFields: CustomFieldValues = { ...(action.applyFlowValues ? sharedValues.customFields : {}) };
                for (const property of action.properties) {
                  const value = requiredValue(property.value, context);
                  if (property.storage === "metadata") metadata[property.key] = value;
                  else customFields[property.key] = value as CustomFieldValues[string];
                }
                report.metadata = metadata;
                report.customFields = customFields;
                if (action.type === "unit") {
                  if (action.mode === "create" && unit) throw new ScanWorkflowError(`Die Einheit „${code}“ existiert bereits.`, 409);
                  if (action.mode === "update" && !unit) throw new ScanWorkflowError(`Die Einheit „${code}“ wurde nicht gefunden.`, 404);
                  let saved;
                  if (unit) {
                    saved = await updateStockUnit(organizationId, resourceId, unit.id, { metadata: { ...unit.metadata, ...metadata }, customFields: { ...unit.customFields, ...customFields }, ...(action.status ? { status: action.status } : {}) }, identity.actor, tx);
                  } else {
                    const created = await createStockUnits(organizationId, resourceId, { code, metadata, customFields }, identity.actor, tx, [plannedId(planHash, selectedId, action.id, "unit", 0)]);
                    saved = { unit: created.units[0], resource: created.resource };
                    if (action.status && action.status !== "available") saved = await updateStockUnit(organizationId, resourceId, saved.unit.id, { status: action.status }, identity.actor, tx);
                  }
                  output = { ...saved.unit, unitId: saved.unit.id, resourceId, found: true, quantity: saved.resource.quantity };
                } else {
                  const quantity = integerValue(action.quantity, context, 1, 1000);
                  if (quantity > 1 && code.length > 175) throw new ScanWorkflowError("Bei mehreren Geräten darf die Kennung höchstens 175 Zeichen lang sein.", 422);
                  const componentResourceSelections: Record<string, string> = {};
                  const componentUnitIds: Record<string, string[]> = {};
                  for (const component of action.components) {
                    if (component.resource) componentResourceSelections[component.slotKey] = String(requiredValue(component.resource, context));
                    if (component.choice) {
                      const choice = component.choice.resources[String(context.inputs[component.choice.inputKey])];
                      if (!choice) throw new ScanWorkflowError(`Keine Komponente für die Auswahl „${component.choice.inputKey}“ konfiguriert.`, 422);
                      componentResourceSelections[component.slotKey] = choice;
                    }
                    if (component.unitFromAction) {
                      const found = context.results[component.unitFromAction];
                      if (!found?.unitId || !found.resourceId) throw new ScanWorkflowError("Die ausgewählte Platine/Komponente wurde nicht gefunden.", 422);
                      const componentId = String(found.resourceId);
                      componentResourceSelections[component.slotKey] = componentId;
                      componentUnitIds[componentId] = [...(componentUnitIds[componentId] ?? []), String(found.unitId)];
                    }
                  }
                  const serialized = settings.find((setting) => setting.resourceId === resourceId)?.trackingMode === "serialized";
                  if (!serialized && (Object.keys(metadata).length || Object.keys(customFields).length)) throw new ScanWorkflowError("Eigenschaften einzelner Geräte benötigen serialisierten Fertigbestand.", 422);
                  const built = await buildAssembly(organizationId, resourceId, { quantity, ...(serialized ? { outputUnitCodes: quantity === 1 ? [code] : Array.from({ length: quantity }, (_, i) => `${code}-${i + 1}`) } : {}), outputUnitMetadata: metadata, outputUnitCustomFields: customFields, componentResourceSelections, componentUnitIds, note: `${workflow.name}: ${action.label}` }, identity.actor, { key: randomUUID(), requestHash }, () => true, tx, {
                    buildId: plannedId(planHash, selectedId, action.id, "build", 0),
                    outputUnitIds: Array.from({ length: quantity }, (_, i) => plannedId(planHash, selectedId, action.id, "unit", i)),
                  });
                  const outputUnits = Array.isArray(built.response.outputUnits) ? built.response.outputUnits : [];
                  const firstUnit = outputUnits.length === 1 ? asRecord(outputUnits[0]) : {};
                  output = { ...firstUnit, unitId: firstUnit.id ?? null, unitCount: outputUnits.length, resourceId, found: outputUnits.length > 0, quantity: asRecord(built.response.resource).quantity };
                  report.components = componentReport(built.response);
                }
              }
            }
            context.results[action.id] = output;
            report.quantityAfter = typeof output.quantity === "number" ? output.quantity : resource.quantity;
            report.statusAfter = typeof output.status === "string" ? output.status : report.statusBefore;
          } catch (error) {
            const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 500;
            if (![403, 404, 409, 422].includes(status)) throw error;
            throw new ScanWorkflowError(`${action.label}: ${error instanceof Error ? error.message : "Aktion fehlgeschlagen."}`, status === 404 || status === 422 ? status : 409, { actionId: action.id });
          }
        }
      }
      const report: ChainRunReport = { workflowId: workflow.id, revision: workflow.revision, identifier, planHash, steps };
      if (preview) throw new PreviewRollback(report);
      // The outbox becomes visible to delivery workers only after the whole run commits.
      for (const { action, data } of pendingWebhooks) await enqueueWebhookEvent(tx, { organizationId, type: "inventory.action.executed", aggregateType: "scan-workflow", aggregateId: workflow.id, actor: identity.actor, data: { ...data, eventName: action.eventName, actionId: action.id, identifier } });
      await tx.insert(stockScanExecutions).values({ organizationId, idempotencyKey: identity.key!, deduplicationKey, workflowId: workflow.id, workflowRevision: workflow.revision, resourceId: selectedIds[0], requestHash, codeHash: hash(identifier), codeType: input.codeType as typeof stockScanExecutions.$inferInsert.codeType ?? null, actor: identity.actor, afterMetadata: sharedValues.execution, response: json(report) as unknown as Record<string, unknown> });
      return report;
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.report;
    throw error;
  }
}

// A reviewed plan produces the same identifiers on confirmation, so a property
// referencing a newly created unit/build never changes between preview and commit.
function plannedId(planHash: string, selectedId: string, actionId: string, kind: string, index: number) {
  const hex = hash([planHash, selectedId, actionId, kind, index]);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function requiredValue(value: ActionValue, context: ChainContext) {
  const result = resolveActionValue(value, context);
  if (result === undefined) throw new ScanWorkflowError("Eine Eingabe oder ein Ergebnis aus einer vorherigen Aktion fehlt.", 422);
  return result;
}
function integerValue(value: ActionValue, context: ChainContext, minimum: number, maximum: number) {
  const raw = requiredValue(value, context);
  const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new ScanWorkflowError(`Die Menge muss eine ganze Zahl zwischen ${minimum} und ${maximum} sein.`, 422);
  return number;
}
function componentReport(response: Record<string, unknown>): ChainStepReport["components"] {
  const build = asRecord(response.build);
  const components = Array.isArray(build.components) ? build.components : [];
  return components.map((component) => {
    const item = asRecord(component);
    return { name: String(item.name), quantity: Number(item.quantityConsumed), codes: Array.isArray(item.componentUnits) ? item.componentUnits.map((unit) => String(asRecord(unit).code)) : [] };
  });
}
