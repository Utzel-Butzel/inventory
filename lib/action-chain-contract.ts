import { z } from "zod";

const key = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).refine((value) => !["__proto__", "constructor", "prototype"].includes(value), "This key is reserved.");
const fieldKey = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/).refine((value) => !["__proto__", "constructor", "prototype"].includes(value), "This key is reserved.");
const scalar = z.union([z.string().max(20_000), z.number().finite(), z.boolean(), z.null()]);
export const actionValueSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("literal"), value: scalar }).strict(),
  z.object({ source: z.literal("scan"), field: z.enum(["identifier", "raw"]) }).strict(),
  z.object({ source: z.literal("input"), key: fieldKey }).strict(),
  z.object({ source: z.literal("result"), actionId: key, path: z.string().regex(/^(resourceId|unitId|code|found|status|quantity|metadata\.[A-Za-z0-9_.-]{1,80}|customFields\.[A-Za-z0-9_.-]{1,80})$/) }).strict(),
]);
export const actionConditionSchema = z.object({
  left: actionValueSchema,
  operator: z.enum(["equals", "not-equals", "exists", "missing", "gt", "gte", "lt", "lte"]),
  right: actionValueSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (!["exists", "missing"].includes(value.operator) && !value.right) ctx.addIssue({ code: "custom", message: "Choose a comparison value." });
});
export const actionConditionsSchema = z.object({
  mode: z.enum(["all", "any"]),
  rules: z.array(actionConditionSchema).min(1).max(8),
}).strict();
export const actionTargetSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("selected") }).strict(),
  z.object({ source: z.literal("resource"), resourceId: z.string().uuid() }).strict(),
  z.object({ source: z.literal("result"), actionId: key }).strict(),
]);
const property = z.object({
  key: fieldKey, storage: z.enum(["metadata", "custom-field"]), value: actionValueSchema,
}).strict();
const common = {
  id: key, label: z.string().trim().min(1).max(160), enabled: z.boolean().default(true),
  when: actionConditionsSchema.nullable().default(null),
};
const target = { target: actionTargetSchema, code: actionValueSchema.default({ source: "scan", field: "identifier" }) };
const values = { properties: z.array(property).max(24).default([]), applyFlowValues: z.boolean().default(false) };
export const chainActionSchema = z.discriminatedUnion("type", [
  z.object({ ...common, ...target, type: z.literal("find-unit"), allowMissing: z.boolean().default(false) }).strict(),
  z.object({ ...common, ...target, ...values, type: z.literal("unit"), mode: z.enum(["create", "update", "upsert"]), status: z.enum(["available", "reserved", "in-use", "maintenance", "consumed", "lost", "retired"]).nullable().default(null) }).strict(),
  z.object({ ...common, ...target, ...values, type: z.literal("assembly-build"), quantity: actionValueSchema,
    components: z.array(z.object({
      slotKey: key,
      resource: actionValueSchema.optional(),
      unitFromAction: key.optional(),
      // Map a guided choice (e.g. black/white) to a concrete BOM component variant.
      choice: z.object({ inputKey: fieldKey, resources: z.record(z.string().min(1).max(120), z.string().uuid()).refine((v) => Object.keys(v).length <= 40) }).strict().optional(),
    }).strict()).max(40).default([]),
  }).strict(),
  z.object({ ...common, type: z.literal("stock-adjustment"), target: actionTargetSchema, delta: actionValueSchema, factor: z.union([z.literal(1), z.literal(-1)]).default(1) }).strict(),
  z.object({ ...common, ...target, type: z.literal("set-location"), location: actionValueSchema, structured: z.boolean().default(true) }).strict(),
  z.object({ ...common, type: z.literal("assert"), check: actionConditionsSchema, message: z.string().trim().min(1).max(500) }).strict(),
  z.object({ ...common, type: z.literal("webhook"), eventName: z.string().trim().min(1).max(120), properties: z.array(z.object({ key, value: actionValueSchema }).strict()).max(24).default([]) }).strict(),
]);
export const chainActionsSchema = z.array(chainActionSchema).max(24).superRefine((actions, ctx) => {
  if (actions.length && !actions.some((action) => action.enabled)) ctx.addIssue({ code: "custom", message: "Enable at least one action." });
  const ids = new Set<string>();
  actions.forEach((action, index) => {
    if (ids.has(action.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: "Action ids must be unique." });
    ids.add(action.id);
    if ("properties" in action) {
      const keys = action.properties.map((property) => `${"storage" in property ? property.storage : "event"}:${property.key}`);
      if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: [index, "properties"], message: "Property keys must be unique per storage target." });
    }
    if (action.type === "assembly-build") {
      if (new Set(action.components.map((item) => item.slotKey)).size !== action.components.length) ctx.addIssue({ code: "custom", path: [index, "components"], message: "Configure each component slot only once." });
      for (const component of action.components) if ([component.resource, component.choice, component.unitFromAction].filter(Boolean).length !== 1) ctx.addIssue({ code: "custom", path: [index, "components"], message: "Choose exactly one source per component slot." });
    }
  });
});
export type ActionValue = z.infer<typeof actionValueSchema>;
export type ActionConditions = z.infer<typeof actionConditionsSchema>;
export type ChainAction = z.infer<typeof chainActionSchema>;
export type ActionTarget = z.infer<typeof actionTargetSchema>;
export type ChainContext = { identifier: string; raw: string; inputs: Record<string, unknown>; results: Record<string, Record<string, unknown>> };

export function resolveActionValue(value: ActionValue, context: ChainContext): unknown {
  if (value.source === "literal") return value.value;
  if (value.source === "scan") return value.field === "raw" ? context.raw : context.identifier;
  if (value.source === "input") return Object.hasOwn(context.inputs, value.key) ? context.inputs[value.key] : undefined;
  const result = Object.hasOwn(context.results, value.actionId) ? context.results[value.actionId] : undefined;
  if (!result) return undefined;
  const dot = value.path.indexOf(".");
  const parts = dot === -1 ? [value.path] : [value.path.slice(0, dot), value.path.slice(dot + 1)];
  return parts.reduce<unknown>((current, part) => current && typeof current === "object" && Object.hasOwn(current, part) ? (current as Record<string, unknown>)[part] : undefined, result);
}
export function matchesActionConditions(conditions: ActionConditions | null | undefined, context: ChainContext): boolean {
  if (!conditions) return true;
  const matches = conditions.rules.map((rule) => {
    const left = resolveActionValue(rule.left, context);
    const right = rule.right ? resolveActionValue(rule.right, context) : undefined;
    const present = left !== undefined && left !== null && left !== "";
    switch (rule.operator) {
      case "exists": return present;
      case "missing": return !present;
      case "equals": return left !== undefined && right !== undefined && left === right;
      case "not-equals": return left !== undefined && right !== undefined && left !== right;
      case "gt": return typeof left === "number" && typeof right === "number" && left > right;
      case "gte": return typeof left === "number" && typeof right === "number" && left >= right;
      case "lt": return typeof left === "number" && typeof right === "number" && left < right;
      case "lte": return typeof left === "number" && typeof right === "number" && left <= right;
    }
  });
  return conditions.mode === "all" ? matches.every(Boolean) : matches.some(Boolean);
}

export function actionChainReferenceErrors(actions: ChainAction[], inputKeys: string[]) {
  const errors: string[] = [];
  const previous = new Set<string>();
  const visit = (value: unknown, label: string) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, label)); return; }
    const record = value as Record<string, unknown>;
    if (record.source === "result" && !previous.has(String(record.actionId))) errors.push(`${label}: results must refer to an earlier action.`);
    if (record.source === "input" && !inputKeys.includes(String(record.key))) errors.push(`${label}: unknown input ${record.key}.`);
    if (record.unitFromAction && !previous.has(String(record.unitFromAction))) errors.push(`${label}: component unit must come from an earlier action.`);
    if (record.inputKey && !inputKeys.includes(String(record.inputKey))) errors.push(`${label}: unknown component input ${record.inputKey}.`);
    Object.values(record).forEach((item) => visit(item, label));
  };
  for (const action of actions) {
    if (previous.has(action.id)) errors.push(`Duplicate action id: ${action.id}.`);
    visit(action, action.label);
    previous.add(action.id);
  }
  return errors;
}

export function visibleFlowInputs<T extends { key: string; visibleWhen?: ActionConditions | null }>(fields: T[], context: ChainContext): T[] {
  // Evaluate in field order; hidden input values never influence later fields.
  const inputs: Record<string, unknown> = {};
  return fields.filter((field) => {
    const visible = matchesActionConditions(field.visibleWhen, { ...context, inputs });
    if (visible && Object.hasOwn(context.inputs, field.key)) inputs[field.key] = context.inputs[field.key];
    return visible;
  });
}
