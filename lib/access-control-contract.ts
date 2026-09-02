export const appPermissions = [
  "inventory.read",
  "inventory.create",
  "inventory.update",
  "inventory.delete",
  "inventory.import",
  "inventory.export",
  "stock.read",
  "stock.manage",
  "assignments.read",
  "assignments.manage",
  "counts.read",
  "counts.manage",
  "spatial.read",
  "spatial.manage",
  "orders.read",
  "orders.manage",
  "requests.read",
  "requests.create",
  "requests.manage",
  "workflows.read",
  "workflows.manage",
  "labels.read",
  "labels.manage",
  "ai.analyze",
  "ai.research",
  "ai.recognize",
  "ai.count",
  "ai.images",
  "ai.translate",
  "ai.rooms",
  "settings.inventory-types.manage",
  "settings.custom-fields.manage",
  "settings.languages.manage",
  "users.manage",
  "roles.manage",
  "sharing.manage",
  "tokens.manage",
  "tokens.delegate",
  "webhooks.manage",
] as const;

export type AppPermission = (typeof appPermissions)[number];
export type ApiScope = "read" | "write" | "ai";

export const resourceRulePermissions = [
  "inventory.update",
  "inventory.delete",
  "stock.manage",
  "assignments.manage",
  "counts.manage",
  "spatial.manage",
  "ai.analyze",
  "ai.research",
  "ai.recognize",
  "ai.count",
  "ai.images",
  "ai.translate",
  "ai.rooms",
] as const satisfies readonly AppPermission[];

export type ResourceRulePermission = (typeof resourceRulePermissions)[number];

export const accessRuleFields = [
  "id",
  "name",
  "type",
  "status",
  "sku",
  "location",
  "serialNumber",
  "priority",
  "tags",
  "categories",
  "createdBy",
] as const;

export const accessRuleOperators = [
  "equals",
  "not_equals",
  "contains",
  "starts_with",
  "exists",
  "not_exists",
] as const;

export type AccessRuleOperator = (typeof accessRuleOperators)[number];

export type AccessRuleCondition = {
  field: string;
  operator: AccessRuleOperator;
  value?: string | number | boolean | null;
};

export type AccessControlledResource = {
  id: string;
  name: string;
  type: string;
  status: string;
  sku?: string | null;
  location?: string | null;
  serialNumber?: string | null;
  priority?: number | null;
  tags?: string[] | null;
  categories?: Array<string | { name?: string | null }> | null;
  customFields?: Record<string, unknown> | null;
  createdBy?: string | null;
};

export type AccessRuleLike = {
  roleKey: string;
  permissions: readonly string[];
  conditions: readonly AccessRuleCondition[];
  enabled: boolean;
};

export const permissionGroups: Array<{
  key: string;
  label: string;
  description: string;
  permissions: Array<{
    key: AppPermission;
    label: string;
    description: string;
  }>;
}> = [
  {
    key: "inventory",
    label: "Inventory",
    description: "Core item records and bulk data transfer.",
    permissions: [
      { key: "inventory.read", label: "View items", description: "Browse, search, and open inventory items." },
      { key: "inventory.create", label: "Create items", description: "Add new inventory items." },
      { key: "inventory.update", label: "Update items", description: "Edit item fields, media, relations, and bills of materials." },
      { key: "inventory.delete", label: "Delete items", description: "Permanently delete or merge inventory items." },
      { key: "inventory.import", label: "Import data", description: "Create and update items from CSV files." },
      { key: "inventory.export", label: "Export data", description: "Download the inventory as CSV, Excel, or PDF." },
    ],
  },
  {
    key: "operations",
    label: "Operations",
    description: "Stock, custody, counting, space, and purchasing workflows.",
    permissions: [
      { key: "stock.read", label: "View stock", description: "View balances, movements, units, and locations." },
      { key: "stock.manage", label: "Manage stock", description: "Change balances, units, locations, and builds." },
      { key: "assignments.read", label: "View assignments", description: "View checkouts, reservations, and assignments." },
      { key: "assignments.manage", label: "Manage assignments", description: "Create, return, and cancel assignments." },
      { key: "counts.read", label: "View counts", description: "View inventory cycles and count history." },
      { key: "counts.manage", label: "Manage counts", description: "Configure cycles and record inventory counts." },
      { key: "spatial.read", label: "View spaces", description: "View rooms, scans, maps, and placements." },
      { key: "spatial.manage", label: "Manage spaces", description: "Create scans, structures, and item placements." },
      { key: "orders.read", label: "View orders", description: "View purchase orders and receipts." },
      { key: "orders.manage", label: "Manage orders", description: "Create and update purchase orders and receive stock." },
      { key: "requests.read", label: "View requests", description: "View internal requests and reservation calendars." },
      { key: "requests.create", label: "Create requests", description: "Request inventory for a future time period." },
      { key: "requests.manage", label: "Manage requests", description: "Approve, reject, cancel, and fulfill internal requests." },
      { key: "workflows.read", label: "View scan workflows", description: "View stock scanning workflows." },
      { key: "workflows.manage", label: "Manage scan workflows", description: "Create, edit, and run stock scanning workflows." },
      { key: "labels.read", label: "View labels", description: "View label layouts and print labels." },
      { key: "labels.manage", label: "Manage labels", description: "Create and change reusable label layouts." },
    ],
  },
  {
    key: "ai",
    label: "AI actions",
    description: "Paid AI capabilities can be enabled separately for each role.",
    permissions: [
      { key: "ai.analyze", label: "Analyze item photos", description: "Fill inventory fields from saved item photos." },
      { key: "ai.research", label: "Research items and images", description: "Use web research to fill item details or find a reusable image." },
      { key: "ai.recognize", label: "Recognize items", description: "Match a camera photo to existing inventory." },
      { key: "ai.count", label: "Count from photos", description: "Count visible items with a selectable vision model." },
      { key: "ai.images", label: "Generate images", description: "Create or edit catalogue and cover images." },
      { key: "ai.translate", label: "Translate content", description: "Generate inventory translations with AI." },
      { key: "ai.rooms", label: "Analyze rooms", description: "Detect room finishes and objects from scan photos." },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    description: "Workspace structure, identities, and credentials.",
    permissions: [
      { key: "settings.inventory-types.manage", label: "Manage inventory types", description: "Create and change inventory and relation types." },
      { key: "settings.custom-fields.manage", label: "Manage custom fields", description: "Create and change custom field definitions." },
      { key: "settings.languages.manage", label: "Manage languages", description: "Configure content languages and regenerate translations." },
      { key: "users.manage", label: "Manage users", description: "Create users, assign roles, reset passwords, and disable accounts." },
      { key: "roles.manage", label: "Manage access", description: "Create roles and conditional inventory access rules." },
      { key: "sharing.manage", label: "Manage public sharing", description: "Create and revoke public inventory links." },
      { key: "tokens.manage", label: "Manage API tokens", description: "Create and revoke workspace API credentials." },
      { key: "tokens.delegate", label: "Delegate token access", description: "Create API tokens whose scopes may exceed the creator's own permissions." },
      { key: "webhooks.manage", label: "Manage webhooks", description: "Export workspace inventory events to external endpoints and manage signing secrets and retries." },
    ],
  },
];

const viewerPermissions: AppPermission[] = [
  "inventory.read",
  "stock.read",
  "assignments.read",
  "counts.read",
  "spatial.read",
  "orders.read",
  "requests.read",
  "workflows.read",
  "labels.read",
];

const editorPermissions: AppPermission[] = appPermissions.filter(
  (permission) =>
    !permission.startsWith("settings.") &&
    permission !== "users.manage" &&
    permission !== "roles.manage" &&
    permission !== "sharing.manage" &&
    permission !== "tokens.manage" &&
    permission !== "tokens.delegate" &&
    permission !== "webhooks.manage",
);

export const builtinRolePermissions: Record<
  "admin" | "editor" | "viewer",
  AppPermission[]
> = {
  admin: [...appPermissions],
  editor: editorPermissions,
  viewer: viewerPermissions,
};

export function isAppPermission(value: unknown): value is AppPermission {
  return (
    typeof value === "string" &&
    (appPermissions as readonly string[]).includes(value)
  );
}

export function isResourceRulePermission(
  value: unknown,
): value is ResourceRulePermission {
  return (
    typeof value === "string" &&
    (resourceRulePermissions as readonly string[]).includes(value)
  );
}

export function permissionScope(permission: AppPermission): ApiScope {
  if (permission.startsWith("ai.")) return "ai";
  if (
    permission.endsWith(".read") ||
    permission === "inventory.export" ||
    permission === "assignments.read" ||
    permission === "counts.read" ||
    permission === "spatial.read" ||
    permission === "orders.read" ||
    permission === "requests.read" ||
    permission === "workflows.read"
  ) {
    return "read";
  }
  return "write";
}

export function scopesForPermissions(
  permissions: readonly AppPermission[],
): ApiScope[] {
  const scopes = new Set<ApiScope>();
  for (const permission of permissions) scopes.add(permissionScope(permission));
  return (["read", "write", "ai"] as const).filter((scope) => scopes.has(scope));
}

export function permissionsForScopes(scopes: readonly ApiScope[]) {
  const allowed = new Set(scopes);
  return appPermissions.filter(
    (permission) =>
      allowed.has(permissionScope(permission)) &&
      !permission.startsWith("settings.") &&
      permission !== "users.manage" &&
      permission !== "roles.manage" &&
      permission !== "sharing.manage" &&
      permission !== "tokens.manage" &&
      permission !== "tokens.delegate" &&
      permission !== "webhooks.manage",
  );
}

function normalizeComparable(value: unknown): unknown {
  if (typeof value === "string") return value.trim().toLocaleLowerCase("en-US");
  if (value && typeof value === "object" && "name" in value) {
    return normalizeComparable((value as { name?: unknown }).name);
  }
  return value;
}

function isPresent(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function equalsValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return actual.some((entry) => equalsValue(entry, expected));
  }
  return normalizeComparable(actual) === normalizeComparable(expected);
}

function containsValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return actual.some((entry) => containsValue(entry, expected));
  }
  const left = normalizeComparable(actual);
  const right = normalizeComparable(expected);
  if (typeof left === "string" && typeof right === "string") {
    return left.includes(right);
  }
  return left === right;
}

export function resourceFieldValue(
  resource: AccessControlledResource,
  field: string,
): unknown {
  if (field.startsWith("customFields.")) {
    const key = field.slice("customFields.".length);
    return resource.customFields &&
      Object.prototype.hasOwnProperty.call(resource.customFields, key)
      ? resource.customFields[key]
      : undefined;
  }
  if (field === "categories") {
    return resource.categories?.map((category) =>
      typeof category === "string" ? category : category.name,
    );
  }
  return resource[field as keyof AccessControlledResource];
}

export function isAccessRuleField(field: string) {
  return (
    (accessRuleFields as readonly string[]).includes(field) ||
    /^customFields\.[A-Za-z0-9_-]{1,120}$/.test(field)
  );
}

export function accessRuleConditionMatches(
  resource: AccessControlledResource,
  condition: AccessRuleCondition,
) {
  if (
    !condition ||
    typeof condition !== "object" ||
    !isAccessRuleField(condition.field) ||
    !(accessRuleOperators as readonly string[]).includes(condition.operator)
  ) {
    return false;
  }
  const unary =
    condition.operator === "exists" || condition.operator === "not_exists";
  if (!unary && condition.value === undefined) return false;
  if (
    (condition.operator === "contains" ||
      condition.operator === "starts_with") &&
    typeof condition.value === "string" &&
    !condition.value.trim()
  ) {
    return false;
  }
  const actual = resourceFieldValue(resource, condition.field);
  switch (condition.operator) {
    case "equals":
      return equalsValue(actual, condition.value);
    case "not_equals":
      return !equalsValue(actual, condition.value);
    case "contains":
      return containsValue(actual, condition.value);
    case "starts_with": {
      const left = normalizeComparable(actual);
      const right = normalizeComparable(condition.value);
      return (
        typeof left === "string" &&
        typeof right === "string" &&
        left.startsWith(right)
      );
    }
    case "exists":
      return isPresent(actual);
    case "not_exists":
      return !isPresent(actual);
  }
}

export function accessRuleMatches(
  resource: AccessControlledResource,
  rule: AccessRuleLike,
) {
  return (
    rule.enabled &&
    Array.isArray(rule.conditions) &&
    rule.conditions.length > 0 &&
    rule.conditions.every((condition) =>
      accessRuleConditionMatches(resource, condition),
    )
  );
}

export function rulesGrantPermission(options: {
  roleKey: string;
  permission: ResourceRulePermission;
  resource: AccessControlledResource;
  rules: readonly AccessRuleLike[];
}) {
  return options.rules.some(
    (rule) =>
      rule.roleKey === options.roleKey &&
      rule.permissions.includes(options.permission) &&
      accessRuleMatches(options.resource, rule),
  );
}
