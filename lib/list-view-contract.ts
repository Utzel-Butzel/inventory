import { z } from "zod";

const key = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.:-]+$/)
  .refine((value) => !["__proto__", "prototype", "constructor"].includes(value));
export const listViewConfigSchema = z.object({
  query: z.string().max(500),
  filters: z.record(key, z.string().max(16384))
    .refine((value) => Object.keys(value).length <= 20)
    .refine((value) => Object.entries(value).every(([name, entry]) => name === "tag" || entry.length <= 200)),
  sort: key,
  direction: z.enum(["asc", "desc"]),
  layout: z.enum(["table", "grid"]),
  density: z.enum(["comfortable", "compact"]),
  pageSize: z.number().int().min(1).max(500),
  columns: z.array(key).max(30).refine((value) => new Set(value).size === value.length),
}).strict();

export type ListViewConfig = z.infer<typeof listViewConfigSchema>;
export const savedListViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  config: listViewConfigSchema,
}).strict();
export type SavedListView = z.infer<typeof savedListViewSchema>;
export const listViewCollectionSchema = z.object({
  views: z.array(savedListViewSchema).max(30),
  defaultId: z.string().uuid().nullable(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.views.map((view) => view.id)).size !== value.views.length) {
    ctx.addIssue({ code: "custom", message: "View IDs must be unique." });
  }
  if (new Set(value.views.map((view) => view.name.toLocaleLowerCase())).size !== value.views.length) {
    ctx.addIssue({ code: "custom", message: "View names must be unique." });
  }
  if (value.defaultId && !value.views.some((view) => view.id === value.defaultId)) {
    ctx.addIssue({ code: "custom", message: "Default view must exist." });
  }
});
export type ListViewCollection = z.infer<typeof listViewCollectionSchema>;
export type ListViewVisibility = "personal" | "organization";
export type ListViewCollections = Record<ListViewVisibility, ListViewCollection>;
export type ScopedListView = SavedListView & { visibility: ListViewVisibility; key: string; isDefault: boolean };

export function combineListViews(collections: ListViewCollections) {
  const views: ScopedListView[] = (["personal", "organization"] as const).flatMap((visibility) =>
    collections[visibility].views.map((view) => ({
      ...view, visibility, key: visibility + ":" + view.id,
      isDefault: collections[visibility].defaultId === view.id,
    })),
  );
  // A personal start view takes precedence over the organization's start view.
  return { views, defaultId: views.find((view) => view.isDefault)?.key ?? null };
}

export function removeListView(collection: ListViewCollection, id: string): ListViewCollection {
  return { views: collection.views.filter((view) => view.id !== id), defaultId: collection.defaultId === id ? null : collection.defaultId };
}

export function saveListView(collections: ListViewCollections, view: SavedListView, visibility: ListViewVisibility, previous?: ScopedListView): ListViewCollections {
  const target = collections[visibility];
  const replacing = previous?.visibility === visibility;
  if (!view.name.trim() || view.name.trim().length > 80 || target.views.some((entry) => entry.id !== (replacing ? previous.id : null) && entry.name.toLocaleLowerCase() === view.name.trim().toLocaleLowerCase())) throw new Error("name");
  if (!replacing && target.views.length >= 30) throw new Error("limit");
  const next = { ...collections };
  if (previous && !replacing) next[previous.visibility] = removeListView(collections[previous.visibility], previous.id);
  next[visibility] = {
    ...target,
    views: replacing ? target.views.map((entry) => entry.id === previous.id ? view : entry) : [...target.views, view],
  };
  return next;
}

export const listViewWriteSchema = z.object({
  scope: key,
  revision: z.number().int().nonnegative(),
  collection: listViewCollectionSchema,
  organizationRevision: z.number().int().nonnegative().optional(),
  organizationCollection: listViewCollectionSchema.optional(),
}).strict().refine((value) => (value.organizationRevision === undefined) === (value.organizationCollection === undefined), {
  message: "Organization collection and revision must be provided together.",
});
export const listViewScopeSchema = key;

export function createListViewConfig(overrides: Partial<ListViewConfig> = {}): ListViewConfig {
  return { query: "", filters: {}, sort: "default", direction: "asc", layout: "table", density: "comfortable", pageSize: 50, columns: [], ...overrides };
}

export function sameListView(left: ListViewConfig, right: ListViewConfig) {
  const canonical = (value: ListViewConfig) => JSON.stringify({
    ...value, filters: Object.fromEntries(Object.entries(value.filters).sort(([a], [b]) => a.localeCompare(b))),
  });
  return canonical(left) === canonical(right);
}

export function restoreListView(config: ListViewConfig, defaults: ListViewConfig, availableColumns = defaults.columns): ListViewConfig {
  const columns = config.columns.filter((column) => availableColumns.includes(column));
  const primary = defaults.columns[0];
  return {
    ...defaults, ...config,
    filters: { ...defaults.filters, ...config.filters },
    columns: primary ? [primary, ...columns.filter((column) => column !== primary)] : [],
  };
}

export function orderListItems<T>(items: readonly T[], config: Pick<ListViewConfig, "sort" | "direction">, fields: Record<string, (item: T) => string | number | null | undefined>, locale?: string): T[] {
  const field = Object.hasOwn(fields, config.sort) ? fields[config.sort] : undefined;
  if (!field) return [...items];
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return [...items].sort((a, b) => {
    const left = field(a), right = field(b);
    // Missing values stay last in both directions; Array.sort preserves equal rows.
    if (left == null || left === "") return right == null || right === "" ? 0 : 1;
    if (right == null || right === "") return -1;
    const result = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
    return config.direction === "desc" ? -result : result;
  });
}
