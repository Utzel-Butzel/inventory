import { sql } from "drizzle-orm";
import type { ListViewCollection } from "@/lib/list-view-contract";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  ScanWorkflowExtraction,
  ScanWorkflowExtractedField,
  ScanWorkflowFixedProperty,
  ScanWorkflowInputField,
  ScanWorkflowOperation,
} from "@/lib/scan-workflow-contract";
import { scanCodeTypes, type ScanCodeType } from "@/lib/scan-code-types";
import type { PaidAiOperation } from "@/lib/ai-rate-limit-policy";
import type {
  AiBillableAction,
  AiUsageProvider,
} from "@/lib/ai-billing";
import {
  customFieldResourceTypes,
  type CustomFieldEntityType,
  type CustomFieldOption,
  type CustomFieldResourceType,
  type CustomFieldType,
  type CustomFieldValues,
} from "@/lib/custom-field-contract";
import type { LabelElement } from "@/lib/label-setup-contract";
import type { RoomScene, SpatialMatrix4 } from "@/lib/room-scene-contract";
import type { RoomAiAnalysis } from "@/lib/room-ai-analysis-contract";
import type {
  RoomCameraIntrinsics,
  RoomKeyframeFeatureDescriptor,
} from "@/lib/room-keyframe-contract";
import type { SpatialGeoreference } from "@/lib/spatial-structure-contract";
import type {
  AccessRuleCondition,
  AppPermission,
  ResourceRulePermission,
} from "@/lib/access-control-contract";
import type {
  PublicShareAccessMode,
  PublicShareFilter,
  PublicShareScope,
} from "@/lib/public-share-contract";
import type {
  NotificationChannel,
  NotificationEventType,
  NotificationFrequency,
  NotificationLocale,
  NotificationMetadata,
} from "@/lib/notification-contract";
import type {
  WebhookEventType,
  WebhookSubscriptionEventType,
} from "@/lib/webhook-contract";

export const userRoles = ["admin", "editor", "viewer"] as const;
export type BuiltinUserRole = (typeof userRoles)[number];
export type UserRole = string;

/**
 * Stable tenant used to adopt databases created before organizations existed.
 * New multi-organization writes always provide an explicit organization id.
 */
export const DEFAULT_ORGANIZATION_ID =
  "00000000-0000-4000-8000-000000000001";

const organizationIdColumn = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    isReadOnly: boolean("is_read_only").notNull().default(false),
    allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
    aiMonthlyBudgetMicros: bigint("ai_monthly_budget_micros", {
      mode: "number",
    }),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("organizations_slug_unique").on(table.slug),
    check(
      "organizations_slug_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      "organizations_ai_monthly_budget_nonnegative",
      sql`${table.aiMonthlyBudgetMicros} is null or ${table.aiMonthlyBudgetMicros} >= 0`,
    ),
  ],
);

export const accessRoles = pgTable(
  "access_roles",
  {
    organizationId: organizationIdColumn(),
    key: varchar("key", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description").notNull().default(""),
    permissions: text("permissions")
      .array()
      .$type<AppPermission[]>()
      .notNull()
      .default([]),
    isSystem: boolean("is_system").notNull().default(false),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "access_roles_organization_key_pk",
      columns: [table.organizationId, table.key],
    }),
    check(
      "access_roles_key_check",
      sql`${table.key} ~ '^[a-z][a-z0-9_-]{0,63}$'`,
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: varchar("role", { length: 64 })
      .$type<UserRole>()
      .notNull()
      .default("editor"),
    isActive: boolean("is_active").notNull().default(true),
    sessionVersion: integer("session_version").notNull().default(1),
    inventoryPageSize: integer("inventory_page_size").notNull().default(50),
    developerMode: boolean("developer_mode").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_role_active_idx").on(table.role, table.isActive),
    check("users_email_lowercase", sql`${table.email} = lower(${table.email})`),
    check("users_session_version_positive", sql`${table.sessionVersion} > 0`),
    check(
      "users_inventory_page_size_check",
      sql`${table.inventoryPageSize} in (50, 100, 200, 500)`,
    ),
  ],
);

export const userListViews = pgTable("user_list_views", {
  organizationId: organizationIdColumn(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scope: varchar("scope", { length: 100 }).notNull(),
  collection: jsonb("collection").$type<ListViewCollection>().notNull().default({ views: [], defaultId: null }),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.userId, table.scope] }),
  check("user_list_views_revision_check", sql`${table.revision} > 0`),
]);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleKey: varchar("role_key", { length: 64 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "organization_memberships_organization_user_pk",
      columns: [table.organizationId, table.userId],
    }),
    foreignKey({
      name: "organization_memberships_role_fk",
      columns: [table.organizationId, table.roleKey],
      foreignColumns: [accessRoles.organizationId, accessRoles.key],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("organization_memberships_user_active_idx").on(
      table.userId,
      table.isActive,
    ),
    index("organization_memberships_role_idx").on(
      table.organizationId,
      table.roleKey,
    ),
  ],
);

export const inventoryAccessRules = pgTable(
  "inventory_access_rules",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    roleKey: varchar("role_key", { length: 64 }).notNull(),
    permissions: text("permissions")
      .array()
      .$type<ResourceRulePermission[]>()
      .notNull()
      .default([]),
    conditions: jsonb("conditions")
      .$type<AccessRuleCondition[]>()
      .notNull()
      .default([]),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(100),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "inventory_access_rules_role_fk",
      columns: [table.organizationId, table.roleKey],
      foreignColumns: [accessRoles.organizationId, accessRoles.key],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("inventory_access_rules_role_enabled_idx").on(
      table.organizationId,
      table.roleKey,
      table.enabled,
      table.priority,
    ),
    check(
      "inventory_access_rules_permissions_nonempty",
      sql`cardinality(${table.permissions}) > 0`,
    ),
    check(
      "inventory_access_rules_conditions_array",
      sql`jsonb_typeof(${table.conditions}) = 'array' and jsonb_array_length(${table.conditions}) > 0`,
    ),
    check(
      "inventory_access_rules_priority_nonnegative",
      sql`${table.priority} >= 0`,
    ),
  ],
);

export const resourceTypes = customFieldResourceTypes;

export type BuiltinResourceType = (typeof resourceTypes)[number];
export type ResourceType = string;

export const relationOrigins = ["manual", "spatial"] as const;
export type RelationOrigin = (typeof relationOrigins)[number];

export type ResourceRelationAttributes = Record<string, unknown>;

export const assignmentKinds = ["checkout", "assignment", "reservation"] as const;
export type AssignmentKind = (typeof assignmentKinds)[number];

export const assignmentStatuses = ["active", "returned", "cancelled"] as const;
export type AssignmentStatus = (typeof assignmentStatuses)[number];

export const internalRequestStatuses = [
  "submitted",
  "approved",
  "rejected",
  "fulfilled",
  "cancelled",
] as const;
export type InternalRequestStatus = (typeof internalRequestStatuses)[number];

export const internalRequestEventTypes = [
  "submitted",
  "approved",
  "rejected",
  "fulfilled",
  "cancelled",
] as const;
export type InternalRequestEventType =
  (typeof internalRequestEventTypes)[number];

export const stockTrackingModes = ["bulk", "serialized"] as const;
export type StockTrackingMode = (typeof stockTrackingModes)[number];

export const stockUnitStatuses = [
  "available",
  "reserved",
  "in-use",
  "maintenance",
  "consumed",
  "lost",
  "retired",
] as const;
export type StockUnitStatus = (typeof stockUnitStatuses)[number];

export const purchaseOrderStatuses = [
  "draft",
  "ordered",
  "partially-received",
  "received",
  "cancelled",
] as const;
export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];

export const orderTypes = ["purchase", "sale", "loan"] as const;
export type OrderType = (typeof orderTypes)[number];

export const salesOrderStatuses = [
  "draft",
  "confirmed",
  "partially-fulfilled",
  "fulfilled",
  "partially-returned",
  "returned",
  "cancelled",
] as const;
export type SalesOrderStatus = (typeof salesOrderStatuses)[number];

export const orderLineUnitStatuses = [
  "reserved",
  "fulfilled",
  "returned",
] as const;
export type OrderLineUnitStatus = (typeof orderLineUnitStatuses)[number];

export const shipmentStatuses = [
  "draft",
  "ready",
  "shipped",
  "in_transit",
  "delivered",
  "exception",
  "returned",
  "cancelled",
] as const;
export type ShipmentStatus = (typeof shipmentStatuses)[number];

export const loanOrderStatuses = [
  "draft",
  "reserved",
  "partially-issued",
  "issued",
  "partially-returned",
  "returned",
  "overdue",
  "cancelled",
] as const;
export type LoanOrderStatus = (typeof loanOrderStatuses)[number];

export const orderStatuses = [
  ...purchaseOrderStatuses,
  "confirmed",
  "partially-fulfilled",
  "fulfilled",
  "reserved",
  "partially-issued",
  "issued",
  "partially-returned",
  "returned",
  "overdue",
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const roomScanStatuses = ["active", "superseded"] as const;
export type RoomScanStatus = (typeof roomScanStatuses)[number];

export const mediaKinds = [
  "image",
  "video",
  "document",
  "model",
  "unknown",
] as const;
export type MediaKind = (typeof mediaKinds)[number];

export const roomScanAssetKinds = [
  "world_map",
  "model_usdz",
  "structure_model",
  "guide_image",
  "textured_mesh",
  "gaussian_splat",
] as const;
export type RoomScanAssetKind = (typeof roomScanAssetKinds)[number];

export const spatialPlacementMethods = [
  "scene-depth",
  "mesh-raycast",
  "plane-raycast",
  "manual",
] as const;
export type SpatialPlacementMethod = (typeof spatialPlacementMethods)[number];

export type ResourceCategory = {
  name: string;
  color?: string;
};

export type AiMetadata = {
  analyzedAt?: string;
  model?: string;
  confidence?: number;
  generatedFields?: string[];
  sources?: string[];
};

export type ResourceMapCoordinate = [number, number];

type ResourceMapFeatureBase = {
  id: string;
  layer: string;
  description: string;
};

export type ResourceMapFeature = ResourceMapFeatureBase &
  (
    | { type: "point"; coordinates: ResourceMapCoordinate }
    | { type: "polygon"; coordinates: ResourceMapCoordinate[] }
  );

export const inventoryTypeDefinitions = pgTable(
  "inventory_type_definitions",
  {
    organizationId: organizationIdColumn(),
    key: varchar("key", { length: 64 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    description: text("description").notNull().default(""),
    color: varchar("color", { length: 32 }).notNull().default("#635bff"),
    icon: varchar("icon", { length: 80 }).notNull().default("box"),
    canContain: boolean("can_contain").notNull().default(false),
    spatialContainment: boolean("spatial_containment").notNull().default(false),
    position: integer("position").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: "inventory_type_definitions_organization_key_pk",
      columns: [table.organizationId, table.key],
    }),
    index("inventory_type_definitions_active_position_idx").on(
      table.organizationId,
      table.archivedAt,
      table.position,
    ),
    check(
      "inventory_type_definitions_key_check",
      sql`${table.key} ~ '^[a-z][a-z0-9_-]{0,63}$'`,
    ),
    check(
      "inventory_type_definitions_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
  ],
);

export const relationTypeDefinitions = pgTable(
  "relation_type_definitions",
  {
    organizationId: organizationIdColumn(),
    key: varchar("key", { length: 64 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    inverseLabel: varchar("inverse_label", { length: 120 }).notNull(),
    description: text("description").notNull().default(""),
    allowManual: boolean("allow_manual").notNull().default(true),
    spatial: boolean("spatial").notNull().default(false),
    position: integer("position").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: "relation_type_definitions_organization_key_pk",
      columns: [table.organizationId, table.key],
    }),
    index("relation_type_definitions_active_position_idx").on(
      table.organizationId,
      table.archivedAt,
      table.position,
    ),
    check(
      "relation_type_definitions_key_check",
      sql`${table.key} ~ '^[a-z][a-z0-9_-]{0,63}$'`,
    ),
    check(
      "relation_type_definitions_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
  ],
);

export const translationLanguages = pgTable(
  "translation_languages",
  {
    organizationId: organizationIdColumn(),
    code: varchar("code", { length: 35 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    autoTranslate: boolean("auto_translate").notNull().default(true),
    instructions: text("instructions").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: "translation_languages_organization_code_pk",
      columns: [table.organizationId, table.code],
    }),
    uniqueIndex("translation_languages_one_active_default")
      .on(table.organizationId, table.isDefault)
      .where(sql`${table.archivedAt} is null and ${table.isDefault} = true`),
    index("translation_languages_active_position_idx").on(
      table.organizationId,
      table.archivedAt,
      table.position,
    ),
    check(
      "translation_languages_code_check",
      sql`${table.code} ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'`,
    ),
    check(
      "translation_languages_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
  ],
);

export const resources = pgTable(
  "resources",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 240 }).notNull(),
    description: text("description").notNull().default(""),
    type: varchar("type", { length: 64 })
      .$type<ResourceType>()
      .notNull()
      .default("object"),
    status: varchar("status", { length: 32 }).notNull().default("available"),
    sku: varchar("sku", { length: 80 }),
    quantity: integer("quantity").notNull().default(1),
    location: varchar("location", { length: 240 }),
    serialNumber: varchar("serial_number", { length: 180 }),
    barcode: varchar("barcode", { length: 180 }),
    valueCents: integer("value_cents"),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    priority: integer("priority").notNull().default(3),
    tags: text("tags").array().notNull().default([]),
    categories: jsonb("categories")
      .$type<ResourceCategory[]>()
      .notNull()
      .default([]),
    customFields: jsonb("custom_fields")
      .$type<CustomFieldValues>()
      .notNull()
      .default({}),
    relatedResourceIds: uuid("related_resource_ids").array().notNull().default([]),
    gpsLatitude: doublePrecision("gps_latitude"),
    gpsLongitude: doublePrecision("gps_longitude"),
    gpsAltitude: doublePrecision("gps_altitude"),
    mapFeatures: jsonb("map_features")
      .$type<ResourceMapFeature[]>()
      .notNull()
      .default([]),
    notes: text("notes").notNull().default(""),
    aiMetadata: jsonb("ai_metadata").$type<AiMetadata>(),
    contentRevision: integer("content_revision").notNull().default(1),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("resources_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      name: "resources_inventory_type_fk",
      columns: [table.organizationId, table.type],
      foreignColumns: [
        inventoryTypeDefinitions.organizationId,
        inventoryTypeDefinitions.key,
      ],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    uniqueIndex("resources_sku_unique").on(
      table.organizationId,
      table.sku,
    ),
    uniqueIndex("resources_barcode_unique")
      .on(table.organizationId, table.barcode)
      .where(sql`${table.barcode} is not null`),
    index("resources_name_idx").on(table.organizationId, table.name),
    index("resources_type_idx").on(table.organizationId, table.type),
    index("resources_status_idx").on(table.organizationId, table.status),
    index("resources_updated_at_idx").on(table.organizationId, table.updatedAt),
    check("resources_content_revision_positive", sql`${table.contentRevision} > 0`),
    check(
      "resources_custom_fields_object",
      sql`jsonb_typeof(${table.customFields}) = 'object'`,
    ),
  ],
);

export const contactRoles = ["customer", "supplier"] as const;
export type ContactRole = (typeof contactRoles)[number];

export const contacts = pgTable(
  "contacts",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 240 }).notNull(),
    company: varchar("company", { length: 240 }),
    roles: text("roles")
      .array()
      .$type<ContactRole[]>()
      .notNull(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 80 }),
    website: varchar("website", { length: 2_048 }),
    customerNumber: varchar("customer_number", { length: 80 }),
    supplierNumber: varchar("supplier_number", { length: 80 }),
    taxId: varchar("tax_id", { length: 80 }),
    addressLine1: varchar("address_line_1", { length: 240 }),
    addressLine2: varchar("address_line_2", { length: 240 }),
    postalCode: varchar("postal_code", { length: 32 }),
    city: varchar("city", { length: 120 }),
    state: varchar("state", { length: 120 }),
    countryCode: varchar("country_code", { length: 2 }),
    tags: text("tags").array().notNull().default([]),
    notes: text("notes").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("contacts_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    index("contacts_organization_name_idx").on(
      table.organizationId,
      table.name,
    ),
    index("contacts_organization_archived_idx").on(
      table.organizationId,
      table.archivedAt,
    ),
    check("contacts_name_nonempty", sql`length(btrim(${table.name})) > 0`),
    check(
      "contacts_roles_check",
      sql`cardinality(${table.roles}) > 0 and ${table.roles} <@ array['customer', 'supplier']::text[]`,
    ),
    check(
      "contacts_country_code_check",
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

export const contactResources = pgTable(
  "contact_resources",
  {
    organizationId: organizationIdColumn(),
    contactId: uuid("contact_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "contact_resources_organization_contact_resource_pk",
      columns: [table.organizationId, table.contactId, table.resourceId],
    }),
    foreignKey({
      name: "contact_resources_organization_contact_fk",
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "contact_resources_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    index("contact_resources_resource_idx").on(
      table.organizationId,
      table.resourceId,
    ),
  ],
);

export const contactComments = pgTable(
  "contact_comments",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id").notNull(),
    body: text("body").notNull(),
    authorName: varchar("author_name", { length: 160 }).notNull(),
    authorIdentityHash: varchar("author_identity_hash", {
      length: 64,
    }).notNull(),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "contact_comments_organization_contact_fk",
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete("cascade"),
    index("contact_comments_contact_created_idx").on(
      table.organizationId,
      table.contactId,
      table.createdAt,
    ),
    check(
      "contact_comments_body_length_check",
      sql`length(btrim(${table.body})) between 1 and 10000`,
    ),
    check(
      "contact_comments_author_name_nonempty",
      sql`length(btrim(${table.authorName})) > 0`,
    ),
    check(
      "contact_comments_author_identity_hash_check",
      sql`${table.authorIdentityHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const resourceSlugs = pgTable(
  "resource_slugs",
  {
    organizationId: organizationIdColumn(),
    slug: varchar("slug", { length: 80 }).notNull(),
    resourceId: uuid("resource_id").notNull(),
    position: integer("position").notNull().default(0),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "resource_slugs_organization_slug_pk",
      columns: [table.organizationId, table.slug],
    }),
    foreignKey({
      name: "resource_slugs_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    index("resource_slugs_resource_position_idx").on(
      table.organizationId,
      table.resourceId,
      table.position,
    ),
    check(
      "resource_slugs_slug_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and ${table.slug} <> 'new' and ${table.slug} !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "resource_slugs_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
  ],
);

export const resourceFavorites = pgTable(
  "resource_favorites",
  {
    organizationId: organizationIdColumn(),
    userId: uuid("user_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "resource_favorites_organization_user_resource_pk",
      columns: [table.organizationId, table.userId, table.resourceId],
    }),
    foreignKey({
      name: "resource_favorites_membership_fk",
      columns: [table.organizationId, table.userId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "resource_favorites_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    index("resource_favorites_user_created_idx").on(
      table.organizationId,
      table.userId,
      table.createdAt,
    ),
  ],
);

export const resourceComments = pgTable(
  "resource_comments",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorName: varchar("author_name", { length: 160 }).notNull(),
    authorIdentityHash: varchar("author_identity_hash", {
      length: 64,
    }).notNull(),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_comments_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    index("resource_comments_resource_created_idx").on(
      table.organizationId,
      table.resourceId,
      table.createdAt,
    ),
    check(
      "resource_comments_body_length_check",
      sql`length(btrim(${table.body})) between 1 and 10000`,
    ),
    check(
      "resource_comments_author_name_nonempty",
      sql`length(btrim(${table.authorName})) > 0`,
    ),
    check(
      "resource_comments_author_identity_hash_check",
      sql`${table.authorIdentityHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const internalRequests = pgTable(
  "internal_requests",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    reference: varchar("reference", { length: 24 }).notNull(),
    status: varchar("status", { length: 24 })
      .$type<InternalRequestStatus>()
      .notNull()
      .default("submitted"),
    requesterUserId: uuid("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requesterName: varchar("requester_name", { length: 160 }).notNull(),
    requesterEmail: varchar("requester_email", { length: 320 }),
    deliveryResourceId: uuid("delivery_resource_id").references(
      () => resources.id,
      { onDelete: "set null" },
    ),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    note: text("note").notNull().default(""),
    decisionNote: text("decision_note").notNull().default(""),
    decidedBy: varchar("decided_by", { length: 320 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    fulfilledBy: varchar("fulfilled_by", { length: 320 }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    idempotencyKey: uuid("idempotency_key"),
    requestHash: varchar("request_hash", { length: 64 }),
    createdBy: varchar("created_by", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "internal_requests_organization_delivery_fk",
      columns: [table.organizationId, table.deliveryResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }),
    uniqueIndex("internal_requests_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("internal_requests_reference_unique").on(
      table.organizationId,
      table.reference,
    ),
    uniqueIndex("internal_requests_idempotency_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("internal_requests_status_starts_idx").on(
      table.organizationId,
      table.status,
      table.startsAt,
    ),
    index("internal_requests_requester_idx").on(
      table.organizationId,
      table.requesterUserId,
      table.createdAt,
    ),
    index("internal_requests_window_idx").on(
      table.organizationId,
      table.startsAt,
      table.dueAt,
    ),
    check(
      "internal_requests_status_check",
      sql`${table.status} in ('submitted', 'approved', 'rejected', 'fulfilled', 'cancelled')`,
    ),
    check(
      "internal_requests_window_check",
      sql`${table.dueAt} > ${table.startsAt}`,
    ),
    check(
      "internal_requests_requester_name_nonempty",
      sql`length(btrim(${table.requesterName})) > 0`,
    ),
    check(
      "internal_requests_idempotency_fields_consistent",
      sql`(${table.idempotencyKey} is null and ${table.requestHash} is null) or (${table.idempotencyKey} is not null and ${table.requestHash} ~ '^[0-9a-f]{64}$')`,
    ),
  ],
);

export const internalRequestLines = pgTable(
  "internal_request_lines",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => internalRequests.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "internal_request_lines_organization_request_fk",
      columns: [table.organizationId, table.requestId],
      foreignColumns: [internalRequests.organizationId, internalRequests.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "internal_request_lines_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("restrict"),
    uniqueIndex("internal_request_lines_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("internal_request_lines_request_resource_unique").on(
      table.requestId,
      table.resourceId,
    ),
    index("internal_request_lines_resource_idx").on(
      table.organizationId,
      table.resourceId,
    ),
    check(
      "internal_request_lines_quantity_positive",
      sql`${table.quantity} > 0`,
    ),
  ],
);

export const internalRequestEvents = pgTable(
  "internal_request_events",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => internalRequests.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 24 })
      .$type<InternalRequestEventType>()
      .notNull(),
    actor: varchar("actor", { length: 320 }).notNull(),
    note: text("note").notNull().default(""),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "internal_request_events_organization_request_fk",
      columns: [table.organizationId, table.requestId],
      foreignColumns: [internalRequests.organizationId, internalRequests.id],
    }).onDelete("cascade"),
    index("internal_request_events_request_occurred_idx").on(
      table.organizationId,
      table.requestId,
      table.occurredAt,
    ),
    check(
      "internal_request_events_type_check",
      sql`${table.type} in ('submitted', 'approved', 'rejected', 'fulfilled', 'cancelled')`,
    ),
  ],
);

/**
 * Optional sellable/stocked choices that belong to one inventory item.
 *
 * The resource quantity remains the canonical total used by all existing stock
 * code. Variant quantities allocate part of that total; stock that has not been
 * allocated to a variant remains available on the parent item. Variants are
 * deliberately bulk-only so identified-unit tracking keeps its established,
 * resource-level ownership model.
 */
export const resourceVariants = pgTable(
  "resource_variants",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 240 }).notNull(),
    sku: varchar("sku", { length: 80 }),
    barcode: varchar("barcode", { length: 180 }),
    priceCents: integer("price_cents"),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    quantity: integer("quantity").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_variants_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    uniqueIndex("resource_variants_resource_name_unique").on(
      table.resourceId,
      table.name,
    ),
    uniqueIndex("resource_variants_id_resource_unique").on(
      table.id,
      table.resourceId,
    ),
    index("resource_variants_resource_position_idx").on(
      table.resourceId,
      table.position,
    ),
    uniqueIndex("resource_variants_sku_unique")
      .on(table.organizationId, table.sku)
      .where(sql`${table.sku} is not null`),
    uniqueIndex("resource_variants_barcode_unique")
      .on(table.organizationId, table.barcode)
      .where(sql`${table.barcode} is not null`),
    check("resource_variants_name_nonempty", sql`length(btrim(${table.name})) > 0`),
    check("resource_variants_price_nonnegative", sql`${table.priceCents} is null or ${table.priceCents} >= 0`),
    check("resource_variants_position_nonnegative", sql`${table.position} >= 0`),
    check("resource_variants_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const resourceTranslations = pgTable(
  "resource_translations",
  {
    organizationId: organizationIdColumn(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    languageCode: varchar("language_code", { length: 35 }).notNull(),
    translatedFields: jsonb("translated_fields")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    sourceHashes: jsonb("source_hashes")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    manualFields: text("manual_fields").array().notNull().default([]),
    suggestedFields: jsonb("suggested_fields")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    suggestionSourceHashes: jsonb("suggestion_source_hashes")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    policyHash: varchar("policy_hash", { length: 64 }).notNull().default(""),
    status: varchar("status", { length: 24 })
      .$type<"current" | "stale" | "needs_review" | "failed">()
      .notNull()
      .default("stale"),
    model: varchar("model", { length: 120 }),
    lastError: text("last_error"),
    revision: integer("revision").notNull().default(1),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_translations_language_fk",
      columns: [table.organizationId, table.languageCode],
      foreignColumns: [
        translationLanguages.organizationId,
        translationLanguages.code,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    primaryKey({
      name: "resource_translations_pk",
      columns: [table.organizationId, table.resourceId, table.languageCode],
    }),
    index("resource_translations_language_idx").on(table.languageCode),
    check(
      "resource_translations_translated_fields_object",
      sql`jsonb_typeof(${table.translatedFields}) = 'object'`,
    ),
    check(
      "resource_translations_source_hashes_object",
      sql`jsonb_typeof(${table.sourceHashes}) = 'object'`,
    ),
    check(
      "resource_translations_suggested_fields_object",
      sql`jsonb_typeof(${table.suggestedFields}) = 'object'`,
    ),
    check(
      "resource_translations_suggestion_hashes_object",
      sql`jsonb_typeof(${table.suggestionSourceHashes}) = 'object'`,
    ),
    check(
      "resource_translations_policy_hash_check",
      sql`${table.policyHash} = '' or ${table.policyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "resource_translations_status_check",
      sql`${table.status} in ('current', 'stale', 'needs_review', 'failed')`,
    ),
    check(
      "resource_translations_revision_positive",
      sql`${table.revision} > 0`,
    ),
  ],
);

export const resourceTranslationJobs = pgTable(
  "resource_translation_jobs",
  {
    organizationId: organizationIdColumn(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    languageCode: varchar("language_code", { length: 35 }).notNull(),
    generation: integer("generation").notNull().default(1),
    sourceRevision: integer("source_revision").notNull().default(1),
    requestId: uuid("request_id").defaultRandom().notNull(),
    mode: varchar("mode", { length: 16 })
      .$type<"automatic" | "manual">()
      .notNull()
      .default("automatic"),
    force: boolean("force").notNull().default(false),
    status: varchar("status", { length: 16 })
      .$type<"pending" | "processing" | "failed">()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    requestedBy: varchar("requested_by", { length: 320 })
      .notNull()
      .default("system:translation"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_translation_jobs_language_fk",
      columns: [table.organizationId, table.languageCode],
      foreignColumns: [
        translationLanguages.organizationId,
        translationLanguages.code,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    primaryKey({
      name: "resource_translation_jobs_pk",
      columns: [table.organizationId, table.resourceId, table.languageCode],
    }),
    index("resource_translation_jobs_due_idx").on(
      table.status,
      table.runAfter,
    ),
    index("resource_translation_jobs_lease_idx").on(table.leaseExpiresAt),
    check(
      "resource_translation_jobs_generation_positive",
      sql`${table.generation} > 0`,
    ),
    check(
      "resource_translation_jobs_source_revision_positive",
      sql`${table.sourceRevision} > 0`,
    ),
    check(
      "resource_translation_jobs_mode_check",
      sql`${table.mode} in ('automatic', 'manual')`,
    ),
    check(
      "resource_translation_jobs_status_check",
      sql`${table.status} in ('pending', 'processing', 'failed')`,
    ),
    check(
      "resource_translation_jobs_attempts_nonnegative",
      sql`${table.attempts} >= 0`,
    ),
  ],
);

export const spatialStructures = pgTable(
  "spatial_structures",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 240 }).notNull(),
    description: text("description").notNull().default(""),
    georeference: jsonb("georeference").$type<SpatialGeoreference>(),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("spatial_structures_name_idx").on(table.name),
    index("spatial_structures_updated_at_idx").on(table.updatedAt),
    check(
      "spatial_structures_georeference_object",
      sql`${table.georeference} is null or jsonb_typeof(${table.georeference}) = 'object'`,
    ),
  ],
);

export const spatialCoordinateSpaces = pgTable(
  "spatial_coordinate_spaces",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").primaryKey(),
    structureId: uuid("structure_id")
      .notNull()
      .references(() => spatialStructures.id, { onDelete: "cascade" }),
    georeference: jsonb("georeference").$type<SpatialGeoreference>(),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("spatial_coordinate_spaces_id_structure_unique").on(
      table.id,
      table.structureId,
    ),
    index("spatial_coordinate_spaces_structure_idx").on(table.structureId),
    check(
      "spatial_coordinate_spaces_georeference_object",
      sql`${table.georeference} is null or jsonb_typeof(${table.georeference}) = 'object'`,
    ),
  ],
);

export const roomScans = pgTable(
  "room_scans",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").primaryKey(),
    roomResourceId: uuid("room_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    structureId: uuid("structure_id").references(() => spatialStructures.id, {
      onDelete: "set null",
    }),
    coordinateSpaceId: uuid("coordinate_space_id"),
    floorIdentifier: varchar("floor_identifier", { length: 120 }),
    floorIndex: integer("floor_index"),
    roomIdentifier: varchar("room_identifier", { length: 120 }),
    revision: integer("revision").notNull(),
    status: varchar("status", { length: 16 })
      .$type<RoomScanStatus>()
      .notNull()
      .default("active"),
    scene: jsonb("scene").$type<RoomScene>().notNull(),
    aiAnalysis: jsonb("ai_analysis").$type<RoomAiAnalysis>(),
    layoutTransform: jsonb("layout_transform").$type<SpatialMatrix4>(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    deviceModel: varchar("device_model", { length: 120 }),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("room_scans_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      name: "room_scans_organization_resource_fk",
      columns: [table.organizationId, table.roomResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    // The hand-written migration uses PostgreSQL's column-specific
    // ON DELETE SET NULL (coordinate_space_id), preserving structure-only
    // legacy scans. Drizzle currently models only the generic action.
    foreignKey({
      name: "room_scans_coordinate_space_structure_fk",
      columns: [table.coordinateSpaceId, table.structureId],
      foreignColumns: [
        spatialCoordinateSpaces.id,
        spatialCoordinateSpaces.structureId,
      ],
    }).onDelete("set null"),
    uniqueIndex("room_scans_room_revision_unique").on(
      table.roomResourceId,
      table.revision,
    ),
    uniqueIndex("room_scans_one_active_per_room")
      .on(table.roomResourceId)
      .where(sql`${table.status} = 'active'`),
    index("room_scans_room_status_idx").on(table.roomResourceId, table.status),
    index("room_scans_structure_status_idx").on(table.structureId, table.status),
    index("room_scans_coordinate_space_idx").on(table.coordinateSpaceId),
    index("room_scans_structure_floor_idx").on(
      table.structureId,
      table.floorIndex,
      table.floorIdentifier,
    ),
    index("room_scans_captured_at_idx").on(table.capturedAt),
    check("room_scans_revision_positive", sql`${table.revision} > 0`),
    check(
      "room_scans_status_check",
      sql`${table.status} in ('active', 'superseded')`,
    ),
    check("room_scans_scene_object", sql`jsonb_typeof(${table.scene}) = 'object'`),
    check(
      "room_scans_ai_analysis_object",
      sql`${table.aiAnalysis} is null or jsonb_typeof(${table.aiAnalysis}) = 'object'`,
    ),
    check(
      "room_scans_layout_transform_array",
      sql`${table.layoutTransform} is null or (jsonb_typeof(${table.layoutTransform}) = 'array' and jsonb_array_length(${table.layoutTransform}) = 16)`,
    ),
    check(
      "room_scans_coordinate_space_requires_structure",
      sql`${table.coordinateSpaceId} is null or ${table.structureId} is not null`,
    ),
  ],
);

export const roomScanAssets = pgTable(
  "room_scan_assets",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    roomScanId: uuid("room_scan_id")
      .notNull()
      .references(() => roomScans.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 24 }).$type<RoomScanAssetKind>().notNull(),
    storageKey: text("storage_key").notNull(),
    storageUrl: text("storage_url").notNull(),
    name: varchar("name", { length: 280 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }).notNull(),
    size: integer("size").notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "room_scan_assets_organization_scan_fk",
      columns: [table.organizationId, table.roomScanId],
      foreignColumns: [roomScans.organizationId, roomScans.id],
    }).onDelete("cascade"),
    uniqueIndex("room_scan_assets_scan_kind_unique").on(
      table.roomScanId,
      table.kind,
    ),
    index("room_scan_assets_scan_idx").on(table.roomScanId),
    check(
      "room_scan_assets_kind_check",
      sql`${table.kind} in ('world_map', 'model_usdz', 'structure_model', 'guide_image', 'textured_mesh', 'gaussian_splat')`,
    ),
    check("room_scan_assets_size_nonnegative", sql`${table.size} >= 0`),
  ],
);

export const roomScanKeyframes = pgTable(
  "room_scan_keyframes",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").primaryKey(),
    roomScanId: uuid("room_scan_id")
      .notNull()
      .references(() => roomScans.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    frameTimestamp: doublePrecision("frame_timestamp").notNull(),
    cameraTransform: jsonb("camera_transform").$type<number[]>().notNull(),
    intrinsics: jsonb("intrinsics").$type<RoomCameraIntrinsics>().notNull(),
    imageWidth: integer("image_width").notNull(),
    imageHeight: integer("image_height").notNull(),
    orientation: varchar("orientation", { length: 24 }).notNull(),
    quality: doublePrecision("quality").notNull(),
    featureDescriptor: jsonb("feature_descriptor")
      .$type<RoomKeyframeFeatureDescriptor | null>(),
    storageKey: text("storage_key").notNull(),
    storageUrl: text("storage_url").notNull(),
    name: varchar("name", { length: 280 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }).notNull(),
    size: integer("size").notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "room_scan_keyframes_organization_scan_fk",
      columns: [table.organizationId, table.roomScanId],
      foreignColumns: [roomScans.organizationId, roomScans.id],
    }).onDelete("cascade"),
    index("room_scan_keyframes_scan_time_idx").on(
      table.roomScanId,
      table.frameTimestamp,
    ),
    check("room_scan_keyframes_timestamp_nonnegative", sql`${table.frameTimestamp} >= 0`),
    check(
      "room_scan_keyframes_dimensions_range",
      sql`${table.imageWidth} between 1 and 4096 and ${table.imageHeight} between 1 and 4096`,
    ),
    check(
      "room_scan_keyframes_orientation_check",
      sql`${table.orientation} in ('up', 'up-mirrored', 'down', 'down-mirrored', 'left-mirrored', 'right', 'right-mirrored', 'left')`,
    ),
    check(
      "room_scan_keyframes_quality_range",
      sql`${table.quality} between 0 and 1`,
    ),
    check(
      "room_scan_keyframes_camera_transform_array",
      sql`jsonb_typeof(${table.cameraTransform}) = 'array' and jsonb_array_length(${table.cameraTransform}) = 16`,
    ),
    check(
      "room_scan_keyframes_intrinsics_array",
      sql`jsonb_typeof(${table.intrinsics}) = 'array' and jsonb_array_length(${table.intrinsics}) = 9`,
    ),
    check("room_scan_keyframes_size_positive", sql`${table.size} > 0`),
  ],
);

export const resourceSpatialPlacements = pgTable(
  "resource_spatial_placements",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    roomScanId: uuid("room_scan_id")
      .notNull()
      .references(() => roomScans.id, { onDelete: "cascade" }),
    positionX: doublePrecision("position_x").notNull(),
    positionY: doublePrecision("position_y").notNull(),
    positionZ: doublePrecision("position_z").notNull(),
    quaternionX: doublePrecision("quaternion_x").notNull().default(0),
    quaternionY: doublePrecision("quaternion_y").notNull().default(0),
    quaternionZ: doublePrecision("quaternion_z").notNull().default(0),
    quaternionW: doublePrecision("quaternion_w").notNull().default(1),
    extentX: doublePrecision("extent_x"),
    extentY: doublePrecision("extent_y"),
    extentZ: doublePrecision("extent_z"),
    confidence: doublePrecision("confidence").notNull(),
    method: varchar("method", { length: 24 })
      .$type<SpatialPlacementMethod>()
      .notNull(),
    anchorIdentifier: uuid("anchor_identifier"),
    localizationEvidence: jsonb("localization_evidence").$type<{
      matchedKeyframeId: string;
      distance: number;
      confidence: number;
      cameraPositionError?: number;
    }>(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("resource_spatial_placements_resource_unique").on(table.resourceId),
    index("resource_spatial_placements_scan_idx").on(table.roomScanId),
    check(
      "resource_spatial_placements_method_check",
      sql`${table.method} in ('scene-depth', 'mesh-raycast', 'plane-raycast', 'manual')`,
    ),
    check(
      "resource_spatial_placements_confidence_range",
      sql`${table.confidence} between 0 and 1`,
    ),
    check(
      "resource_spatial_placements_quaternion_normalized",
      sql`abs(((${table.quaternionX} * ${table.quaternionX}) + (${table.quaternionY} * ${table.quaternionY}) + (${table.quaternionZ} * ${table.quaternionZ}) + (${table.quaternionW} * ${table.quaternionW})) - 1) < 0.1`,
    ),
    check(
      "resource_spatial_placements_extent_nonnegative",
      sql`(${table.extentX} is null or ${table.extentX} between 0 and 100) and (${table.extentY} is null or ${table.extentY} between 0 and 100) and (${table.extentZ} is null or ${table.extentZ} between 0 and 100)`,
    ),
    check(
      "resource_spatial_placements_localization_evidence_object",
      sql`${table.localizationEvidence} is null or jsonb_typeof(${table.localizationEvidence}) = 'object'`,
    ),
  ],
);

export const resourceRelations = pgTable(
  "resource_relations",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    sourceResourceId: uuid("source_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    targetResourceId: uuid("target_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    relationTypeKey: varchar("relation_type_key", { length: 64 }).notNull(),
    origin: varchar("origin", { length: 16 })
      .$type<RelationOrigin>()
      .notNull()
      .default("manual"),
    sourceFeatureId: varchar("source_feature_id", { length: 80 }),
    targetFeatureId: varchar("target_feature_id", { length: 80 }),
    attributes: jsonb("attributes")
      .$type<ResourceRelationAttributes>()
      .notNull()
      .default({}),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_relations_relation_type_fk",
      columns: [table.organizationId, table.relationTypeKey],
      foreignColumns: [
        relationTypeDefinitions.organizationId,
        relationTypeDefinitions.key,
      ],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    uniqueIndex("resource_relations_edge_unique").on(
      table.sourceResourceId,
      table.targetResourceId,
      table.relationTypeKey,
    ),
    uniqueIndex("resource_relations_variant_source_unique")
      .on(table.organizationId, table.sourceResourceId)
      .where(sql`${table.relationTypeKey} = 'variant_of'`),
    index("resource_relations_source_idx").on(
      table.sourceResourceId,
      table.relationTypeKey,
    ),
    index("resource_relations_target_idx").on(
      table.targetResourceId,
      table.relationTypeKey,
    ),
    check(
      "resource_relations_distinct_resources",
      sql`${table.sourceResourceId} <> ${table.targetResourceId}`,
    ),
    check(
      "resource_relations_origin_check",
      sql`${table.origin} in ('manual', 'spatial')`,
    ),
    check(
      "resource_relations_attributes_object",
      sql`jsonb_typeof(${table.attributes}) = 'object'`,
    ),
  ],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: varchar("entity_type", { length: 24 })
      .$type<CustomFieldEntityType>()
      .notNull(),
    key: varchar("key", { length: 64 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    description: text("description").notNull().default(""),
    placeholder: varchar("placeholder", { length: 240 }).notNull().default(""),
    fieldType: varchar("field_type", { length: 24 })
      .$type<CustomFieldType>()
      .notNull(),
    required: boolean("required").notNull().default(false),
    minValue: doublePrecision("min_value"),
    maxValue: doublePrecision("max_value"),
    step: doublePrecision("step"),
    resourceTypes: jsonb("resource_types")
      .$type<CustomFieldResourceType[]>()
      .notNull()
      .default([]),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    options: jsonb("options")
      .$type<CustomFieldOption[]>()
      .notNull()
      .default([]),
    referenceEntityType: varchar("reference_entity_type", { length: 24 })
      .$type<CustomFieldEntityType>(),
    referenceMultiple: boolean("reference_multiple").notNull().default(false),
    referenceResourceTypes: jsonb("reference_resource_types")
      .$type<CustomFieldResourceType[]>()
      .notNull()
      .default([]),
    referenceCategories: jsonb("reference_categories")
      .$type<string[]>()
      .notNull()
      .default([]),
    referenceStatuses: jsonb("reference_statuses")
      .$type<string[]>()
      .notNull()
      .default([]),
    position: integer("position").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("custom_field_definitions_entity_key_unique").on(
      table.organizationId,
      table.entityType,
      table.key,
    ),
    index("custom_field_definitions_entity_active_position_idx").on(
      table.entityType,
      table.archivedAt,
      table.position,
    ),
    check(
      "custom_field_definitions_entity_type_check",
      sql`${table.entityType} in ('inventory', 'stock_unit')`,
    ),
    check(
      "custom_field_definitions_field_type_check",
      sql`${table.fieldType} in ('text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'select', 'multi_select', 'reference', 'email', 'url')`,
    ),
    check(
      "custom_field_definitions_key_check",
      sql`${table.key} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      "custom_field_definitions_resource_types_array",
      sql`jsonb_typeof(${table.resourceTypes}) = 'array'`,
    ),
    check(
      "custom_field_definitions_categories_array",
      sql`jsonb_typeof(${table.categories}) = 'array'`,
    ),
    check(
      "custom_field_definitions_options_array",
      sql`jsonb_typeof(${table.options}) = 'array'`,
    ),
    check(
      "custom_field_definitions_reference_entity_type_check",
      sql`${table.referenceEntityType} is null or ${table.referenceEntityType} in ('inventory', 'stock_unit')`,
    ),
    check(
      "custom_field_definitions_reference_resource_types_array",
      sql`jsonb_typeof(${table.referenceResourceTypes}) = 'array'`,
    ),
    check(
      "custom_field_definitions_reference_categories_array",
      sql`jsonb_typeof(${table.referenceCategories}) = 'array'`,
    ),
    check(
      "custom_field_definitions_reference_statuses_array",
      sql`jsonb_typeof(${table.referenceStatuses}) = 'array'`,
    ),
    check(
      "custom_field_definitions_reference_configuration_check",
      sql`(
        ${table.fieldType} = 'reference'
        and ${table.referenceEntityType} is not null
      ) or (
        ${table.fieldType} <> 'reference'
        and ${table.referenceEntityType} is null
        and ${table.referenceMultiple} = false
        and ${table.referenceResourceTypes} = '[]'::jsonb
        and ${table.referenceCategories} = '[]'::jsonb
        and ${table.referenceStatuses} = '[]'::jsonb
      )`,
    ),
    check(
      "custom_field_definitions_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
    check(
      "custom_field_definitions_revision_positive",
      sql`${table.revision} > 0`,
    ),
    check(
      "custom_field_definitions_range_check",
      sql`${table.minValue} is null or ${table.maxValue} is null or ${table.minValue} <= ${table.maxValue}`,
    ),
    check(
      "custom_field_definitions_step_positive",
      sql`${table.step} is null or ${table.step} > 0`,
    ),
  ],
);

export const labelSetups = pgTable(
  "label_setups",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    widthMm: doublePrecision("width_mm").notNull(),
    heightMm: doublePrecision("height_mm").notNull(),
    elements: jsonb("elements").$type<LabelElement[]>().notNull(),
    revision: integer("revision").notNull().default(1),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("label_setups_name_unique").on(
      table.organizationId,
      sql`lower(${table.name})`,
    ),
    index("label_setups_name_idx").on(table.name),
    check(
      "label_setups_width_mm_check",
      sql`${table.widthMm} > 0 and ${table.widthMm} <= 1000`,
    ),
    check(
      "label_setups_height_mm_check",
      sql`${table.heightMm} > 0 and ${table.heightMm} <= 1000`,
    ),
    check(
      "label_setups_elements_array",
      sql`jsonb_typeof(${table.elements}) = 'array'`,
    ),
    check("label_setups_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const resourceCreationRequests = pgTable(
  "resource_creation_requests",
  {
    organizationId: organizationIdColumn(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resourceId: uuid("resource_id").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "resource_creation_requests_pk",
      columns: [table.organizationId, table.idempotencyKey],
    }),
    uniqueIndex("resource_creation_requests_resource_id_unique").on(
      table.organizationId,
      table.resourceId,
    ),
    index("resource_creation_requests_resource_id_idx").on(table.resourceId),
  ],
);

export const bomLines = pgTable(
  "bom_lines",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    assemblyResourceId: uuid("assembly_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    componentResourceId: uuid("component_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    slotKey: varchar("slot_key", { length: 80 }).notNull(),
    quantityPerAssembly: integer("quantity_per_assembly").notNull(),
    quantityUnit: varchar("quantity_unit", { length: 16 })
      .$type<"base" | "purchase">()
      .notNull()
      .default("base"),
    position: integer("position").notNull().default(0),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "bom_lines_organization_assembly_fk",
      columns: [table.organizationId, table.assemblyResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bom_lines_organization_component_fk",
      columns: [table.organizationId, table.componentResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("restrict"),
    uniqueIndex("bom_lines_assembly_component_unique").on(
      table.assemblyResourceId,
      table.componentResourceId,
    ),
    uniqueIndex("bom_lines_assembly_slot_unique").on(
      table.assemblyResourceId,
      table.slotKey,
    ),
    index("bom_lines_assembly_resource_id_idx").on(table.assemblyResourceId),
    index("bom_lines_component_resource_id_idx").on(table.componentResourceId),
    check(
      "bom_lines_quantity_per_assembly_positive",
      sql`${table.quantityPerAssembly} > 0`,
    ),
    check(
      "bom_lines_quantity_unit_check",
      sql`${table.quantityUnit} in ('base', 'purchase')`,
    ),
    check("bom_lines_position_nonnegative", sql`${table.position} >= 0`),
    check(
      "bom_lines_slot_key_check",
      sql`${table.slotKey} ~ '^[A-Za-z0-9_-]{1,80}$'`,
    ),
    check(
      "bom_lines_distinct_resources",
      sql`${table.assemblyResourceId} <> ${table.componentResourceId}`,
    ),
  ],
);

/**
 * Sparse changes to a primary item's BOM for one first-class resource variant.
 * A missing row inherits the primary slot. A removed row hides it; otherwise
 * the row replaces that slot or adds a variant-only slot.
 */
export const variantBomOverrides = pgTable(
  "variant_bom_overrides",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    variantResourceId: uuid("variant_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    slotKey: varchar("slot_key", { length: 80 }).notNull(),
    componentResourceId: uuid("component_resource_id").references(
      () => resources.id,
      { onDelete: "restrict" },
    ),
    quantityPerAssembly: integer("quantity_per_assembly"),
    quantityUnit: varchar("quantity_unit", { length: 16 }).$type<
      "base" | "purchase"
    >(),
    position: integer("position"),
    note: text("note").notNull().default(""),
    removed: boolean("removed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "variant_bom_overrides_organization_variant_fk",
      columns: [table.organizationId, table.variantResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "variant_bom_overrides_organization_component_fk",
      columns: [table.organizationId, table.componentResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("restrict"),
    uniqueIndex("variant_bom_overrides_variant_slot_unique").on(
      table.variantResourceId,
      table.slotKey,
    ),
    index("variant_bom_overrides_variant_idx").on(table.variantResourceId),
    index("variant_bom_overrides_component_idx").on(table.componentResourceId),
    check(
      "variant_bom_overrides_slot_key_check",
      sql`${table.slotKey} ~ '^[A-Za-z0-9_-]{1,80}$'`,
    ),
    check(
      "variant_bom_overrides_position_nonnegative",
      sql`${table.position} is null or ${table.position} >= 0`,
    ),
    check(
      "variant_bom_overrides_payload_check",
      sql`(${table.removed} and ${table.componentResourceId} is null and ${table.quantityPerAssembly} is null and ${table.quantityUnit} is null) or (not ${table.removed} and ${table.componentResourceId} is not null and ${table.quantityPerAssembly} > 0 and ${table.quantityUnit} in ('base', 'purchase') and ${table.position} is not null)`,
    ),
    check(
      "variant_bom_overrides_distinct_resources",
      sql`${table.componentResourceId} is null or ${table.variantResourceId} <> ${table.componentResourceId}`,
    ),
  ],
);

/**
 * User-facing dimensions such as language, size, or frame finish. An option
 * group may drive one stable BOM slot; values then select the component used
 * in that slot for each generated first-class resource variant.
 */
export const resourceOptionGroups = pgTable(
  "resource_option_groups",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    primaryResourceId: uuid("primary_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    bomSlotKey: varchar("bom_slot_key", { length: 80 }),
    position: integer("position").notNull().default(0),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_option_groups_organization_primary_fk",
      columns: [table.organizationId, table.primaryResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    uniqueIndex("resource_option_groups_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("resource_option_groups_primary_key_unique").on(
      table.primaryResourceId,
      table.key,
    ),
    uniqueIndex("resource_option_groups_primary_bom_slot_unique")
      .on(table.primaryResourceId, table.bomSlotKey)
      .where(sql`${table.bomSlotKey} is not null`),
    index("resource_option_groups_primary_position_idx").on(
      table.primaryResourceId,
      table.position,
    ),
    check(
      "resource_option_groups_key_check",
      sql`${table.key} ~ '^[a-z][a-z0-9_-]{0,63}$'`,
    ),
    check(
      "resource_option_groups_name_nonempty",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "resource_option_groups_bom_slot_check",
      sql`${table.bomSlotKey} is null or ${table.bomSlotKey} ~ '^[A-Za-z0-9_-]{1,80}$'`,
    ),
    check(
      "resource_option_groups_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
  ],
);

export const resourceOptionValues = pgTable(
  "resource_option_values",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => resourceOptionGroups.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 120 }).notNull(),
    code: varchar("code", { length: 40 }).notNull(),
    componentResourceId: uuid("component_resource_id").references(
      () => resources.id,
      { onDelete: "restrict" },
    ),
    isDefault: boolean("is_default").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_option_values_organization_group_fk",
      columns: [table.organizationId, table.groupId],
      foreignColumns: [
        resourceOptionGroups.organizationId,
        resourceOptionGroups.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "resource_option_values_organization_component_fk",
      columns: [table.organizationId, table.componentResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("restrict"),
    uniqueIndex("resource_option_values_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("resource_option_values_group_id_id_unique").on(
      table.groupId,
      table.id,
    ),
    uniqueIndex("resource_option_values_group_code_unique").on(
      table.groupId,
      table.code,
    ),
    uniqueIndex("resource_option_values_group_default_unique")
      .on(table.groupId)
      .where(sql`${table.isDefault}`),
    index("resource_option_values_group_position_idx").on(
      table.groupId,
      table.position,
    ),
    index("resource_option_values_component_idx").on(
      table.componentResourceId,
    ),
    check(
      "resource_option_values_label_nonempty",
      sql`length(btrim(${table.label})) > 0`,
    ),
    check(
      "resource_option_values_code_check",
      sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'`,
    ),
    check(
      "resource_option_values_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
  ],
);

export const resourceOptionConfigurations = pgTable(
  "resource_option_configurations",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    primaryResourceId: uuid("primary_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    signature: varchar("signature", { length: 1024 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_option_configurations_organization_primary_fk",
      columns: [table.organizationId, table.primaryResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "resource_option_configurations_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    uniqueIndex("resource_option_configurations_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("resource_option_configurations_resource_unique").on(
      table.organizationId,
      table.resourceId,
    ),
    uniqueIndex("resource_option_configurations_signature_unique").on(
      table.primaryResourceId,
      table.signature,
    ),
    index("resource_option_configurations_primary_idx").on(
      table.primaryResourceId,
    ),
    check(
      "resource_option_configurations_signature_nonempty",
      sql`length(${table.signature}) > 0`,
    ),
  ],
);

export const resourceOptionSelections = pgTable(
  "resource_option_selections",
  {
    organizationId: organizationIdColumn(),
    configurationId: uuid("configuration_id")
      .notNull()
      .references(() => resourceOptionConfigurations.id, {
        onDelete: "cascade",
      }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => resourceOptionGroups.id, { onDelete: "cascade" }),
    valueId: uuid("value_id")
      .notNull()
      .references(() => resourceOptionValues.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_option_selections_organization_configuration_fk",
      columns: [table.organizationId, table.configurationId],
      foreignColumns: [
        resourceOptionConfigurations.organizationId,
        resourceOptionConfigurations.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "resource_option_selections_organization_group_fk",
      columns: [table.organizationId, table.groupId],
      foreignColumns: [
        resourceOptionGroups.organizationId,
        resourceOptionGroups.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "resource_option_selections_group_value_fk",
      columns: [table.groupId, table.valueId],
      foreignColumns: [resourceOptionValues.groupId, resourceOptionValues.id],
    }).onDelete("cascade"),
    primaryKey({
      name: "resource_option_selections_pk",
      columns: [table.configurationId, table.groupId],
    }),
    index("resource_option_selections_value_idx").on(table.valueId),
  ],
);

export const assemblyBuilds = pgTable(
  "assembly_builds",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    assemblyResourceId: uuid("assembly_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    location: varchar("location", { length: 240 }),
    note: text("note").notNull().default(""),
    materialCosts: jsonb("material_costs")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    unpricedComponentQuantity: integer("unpriced_component_quantity")
      .notNull()
      .default(0),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    response: jsonb("response")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("assembly_builds_idempotency_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("assembly_builds_assembly_resource_id_idx").on(
      table.assemblyResourceId,
    ),
    index("assembly_builds_assembly_occurred_idx").on(
      table.assemblyResourceId,
      table.occurredAt,
    ),
    check("assembly_builds_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "assembly_builds_unpriced_component_quantity_nonnegative",
      sql`${table.unpricedComponentQuantity} >= 0`,
    ),
    check(
      "assembly_builds_material_costs_object",
      sql`jsonb_typeof(${table.materialCosts}) = 'object'`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    type: varchar("type", { length: 16 })
      .$type<OrderType>()
      .notNull()
      .default("purchase"),
    contactId: uuid("contact_id"),
    contactName: varchar("contact_name", { length: 240 }).notNull(),
    reference: varchar("reference", { length: 160 }),
    status: varchar("status", { length: 32 })
      .$type<OrderStatus>()
      .notNull()
      .default("draft"),
    orderedAt: timestamp("ordered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    idempotencyKey: uuid("idempotency_key"),
    requestHash: varchar("request_hash", { length: 64 }),
    response: jsonb("response")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("orders_idempotency_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "orders_organization_contact_fk",
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete("restrict"),
    index("orders_type_status_idx").on(
      table.organizationId,
      table.type,
      table.status,
    ),
    index("orders_expected_at_idx").on(table.organizationId, table.expectedAt),
    index("orders_contact_id_idx").on(table.organizationId, table.contactId),
    check(
      "orders_type_status_check",
      sql`(${table.type} = 'purchase' and ${table.status} in ('draft', 'ordered', 'partially-received', 'received', 'cancelled')) or (${table.type} = 'sale' and ${table.status} in ('draft', 'confirmed', 'partially-fulfilled', 'fulfilled', 'partially-returned', 'returned', 'cancelled')) or (${table.type} = 'loan' and ${table.status} in ('draft', 'reserved', 'partially-issued', 'issued', 'partially-returned', 'returned', 'overdue', 'cancelled'))`,
    ),
    check("orders_contact_name_nonempty", sql`length(btrim(${table.contactName})) > 0`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id"),
    orderedQuantity: integer("quantity").notNull(),
    fulfilledQuantity: integer("fulfilled_quantity").notNull().default(0),
    returnedQuantity: integer("returned_quantity").notNull().default(0),
    purchaseUnitName: varchar("purchase_unit_name", { length: 80 }),
    purchaseUnitFactor: integer("purchase_unit_factor").notNull().default(1),
    unitPriceCents: integer("unit_price_cents"),
    priceCurrency: varchar("price_currency", { length: 3 }),
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_lines_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    index("order_lines_order_resource_idx").on(
      table.orderId,
      table.resourceId,
    ),
    index("order_lines_order_id_idx").on(table.orderId),
    index("order_lines_resource_id_idx").on(table.resourceId),
    foreignKey({
      name: "order_lines_variant_fk",
      columns: [table.variantId, table.resourceId],
      foreignColumns: [resourceVariants.id, resourceVariants.resourceId],
    }).onDelete("restrict"),
    check(
      "order_lines_quantity_positive",
      sql`${table.orderedQuantity} > 0`,
    ),
    check(
      "order_lines_fulfilled_quantity_nonnegative",
      sql`${table.fulfilledQuantity} >= 0`,
    ),
    check(
      "order_lines_fulfilled_not_above_quantity",
      sql`${table.fulfilledQuantity} <= ${table.orderedQuantity}`,
    ),
    check(
      "order_lines_returned_quantity_valid",
      sql`${table.returnedQuantity} >= 0 and ${table.returnedQuantity} <= ${table.fulfilledQuantity}`,
    ),
    check(
      "order_lines_purchase_unit_valid",
      sql`(${table.purchaseUnitName} is null and ${table.purchaseUnitFactor} = 1) or (${table.purchaseUnitName} is not null and ${table.purchaseUnitFactor} > 0)`,
    ),
    check(
      "order_lines_unit_price_nonnegative",
      sql`${table.unitPriceCents} is null or ${table.unitPriceCents} >= 0`,
    ),
    check(
      "order_lines_price_fields_together",
      sql`(${table.unitPriceCents} is null and ${table.priceCurrency} is null) or (${table.unitPriceCents} is not null and ${table.priceCurrency} ~ '^[A-Z]{3}$')`,
    ),
  ],
);

// Compatibility aliases keep the established purchase-order service and public
// route names stable while all order types share the same physical tables.
export const purchaseOrders = orders;
export const purchaseOrderLines = orderLines;

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    totalPriceCents: integer("total_price_cents"),
    priceCurrency: varchar("price_currency", { length: 3 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    location: varchar("location", { length: 240 }),
    note: text("note").notNull().default(""),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    response: jsonb("response")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("purchase_receipts_idempotency_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("purchase_receipts_order_line_id_idx").on(table.orderLineId),
    index("purchase_receipts_line_occurred_idx").on(
      table.orderLineId,
      table.occurredAt,
    ),
    check("purchase_receipts_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "purchase_receipts_total_price_nonnegative",
      sql`${table.totalPriceCents} is null or ${table.totalPriceCents} >= 0`,
    ),
    check(
      "purchase_receipts_price_fields_together",
      sql`(${table.totalPriceCents} is null and ${table.priceCurrency} is null) or (${table.totalPriceCents} is not null and ${table.priceCurrency} ~ '^[A-Z]{3}$')`,
    ),
  ],
);

export const stockSettings = pgTable(
  "stock_settings",
  {
    organizationId: organizationIdColumn(),
    resourceId: uuid("resource_id")
      .primaryKey()
      .references(() => resources.id, { onDelete: "cascade" }),
    trackingMode: varchar("tracking_mode", { length: 16 })
      .$type<StockTrackingMode>()
      .notNull()
      .default("bulk"),
    minimumStock: integer("minimum_stock").notNull().default(0),
    reorderQuantity: integer("reorder_quantity").notNull().default(0),
    leadTimeDays: integer("lead_time_days").notNull().default(0),
    unitName: varchar("unit_name", { length: 80 }).notNull().default("unit"),
    purchaseUnitName: varchar("purchase_unit_name", { length: 80 }),
    purchaseUnitFactor: integer("purchase_unit_factor"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "stock_settings_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    check(
      "stock_settings_tracking_mode_check",
      sql`${table.trackingMode} in ('bulk', 'serialized')`,
    ),
    check(
      "stock_settings_minimum_nonnegative",
      sql`${table.minimumStock} >= 0`,
    ),
    check(
      "stock_settings_reorder_nonnegative",
      sql`${table.reorderQuantity} >= 0`,
    ),
    check(
      "stock_settings_lead_time_nonnegative",
      sql`${table.leadTimeDays} >= 0`,
    ),
    check(
      "stock_settings_purchase_unit_pair",
      sql`(${table.purchaseUnitName} is null and ${table.purchaseUnitFactor} is null) or (${table.purchaseUnitName} is not null and ${table.purchaseUnitFactor} > 0)`,
    ),
  ],
);

export const resourceLendingSettings = pgTable(
  "resource_lending_settings",
  {
    organizationId: organizationIdColumn(),
    resourceId: uuid("resource_id")
      .primaryKey()
      .references(() => resources.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    approvalRequired: boolean("approval_required").notNull().default(true),
    defaultDurationDays: integer("default_duration_days").notNull().default(7),
    maxDurationDays: integer("max_duration_days").notNull().default(30),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "resource_lending_settings_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    index("resource_lending_settings_enabled_idx").on(
      table.organizationId,
      table.enabled,
    ),
    check(
      "resource_lending_settings_default_duration_check",
      sql`${table.defaultDurationDays} between 1 and 3650`,
    ),
    check(
      "resource_lending_settings_max_duration_check",
      sql`${table.maxDurationDays} between ${table.defaultDurationDays} and 3650`,
    ),
  ],
);

export const stockLocationBalances = pgTable(
  "stock_location_balances",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    locationResourceId: uuid("location_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "stock_location_balances_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_location_balances_organization_location_fk",
      columns: [table.organizationId, table.locationResourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("restrict"),
    uniqueIndex("stock_location_balances_resource_location_unique").on(
      table.resourceId,
      table.locationResourceId,
    ),
    index("stock_location_balances_location_idx").on(table.locationResourceId),
    check(
      "stock_location_balances_distinct_resources",
      sql`${table.resourceId} <> ${table.locationResourceId}`,
    ),
  ],
);

export const inventoryCyclePolicies = pgTable(
  "inventory_cycle_policies",
  {
    organizationId: organizationIdColumn(),
    resourceId: uuid("resource_id")
      .primaryKey()
      .references(() => resources.id, { onDelete: "cascade" }),
    intervalDays: integer("interval_days").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
    lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "inventory_cycle_policies_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    index("inventory_cycle_policies_due_idx").on(table.enabled, table.nextDueAt),
    check(
      "inventory_cycle_policies_interval_check",
      sql`${table.intervalDays} between 1 and 3650`,
    ),
  ],
);

export const stockUnits = pgTable(
  "stock_units",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 180 }).notNull(),
    status: varchar("status", { length: 32 })
      .$type<StockUnitStatus>()
      .notNull()
      .default("available"),
    location: varchar("location", { length: 240 }),
    locationResourceId: uuid("location_resource_id").references(
      () => resources.id,
      { onDelete: "set null" },
    ),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    customFields: jsonb("custom_fields")
      .$type<CustomFieldValues>()
      .notNull()
      .default({}),
    acquisitionCostCents: integer("acquisition_cost_cents"),
    costCurrency: varchar("cost_currency", { length: 3 }),
    acquiredAt: timestamp("acquired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMovedAt: timestamp("last_moved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_units_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      name: "stock_units_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    uniqueIndex("stock_units_resource_code_unique").on(
      table.organizationId,
      table.resourceId,
      table.code,
    ),
    index("stock_units_resource_id_idx").on(table.resourceId),
    index("stock_units_resource_status_idx").on(
      table.resourceId,
      table.status,
    ),
    index("stock_units_location_resource_idx").on(table.locationResourceId),
    check(
      "stock_units_status_check",
      sql`${table.status} in ('available', 'reserved', 'in-use', 'maintenance', 'consumed', 'lost', 'retired')`,
    ),
    check(
      "stock_units_custom_fields_object",
      sql`jsonb_typeof(${table.customFields}) = 'object'`,
    ),
    check(
      "stock_units_acquisition_cost_nonnegative",
      sql`${table.acquisitionCostCents} is null or ${table.acquisitionCostCents} >= 0`,
    ),
    check(
      "stock_units_cost_fields_together",
      sql`(${table.acquisitionCostCents} is null and ${table.costCurrency} is null) or (${table.acquisitionCostCents} is not null and ${table.costCurrency} ~ '^[A-Z]{3}$')`,
    ),
  ],
);

export const orderLineUnits = pgTable(
  "order_line_units",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    orderLineId: uuid("order_line_id").notNull(),
    stockUnitId: uuid("stock_unit_id").notNull(),
    status: varchar("status", { length: 16 })
      .$type<OrderLineUnitStatus>()
      .notNull()
      .default("reserved"),
    reservedAt: timestamp("reserved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_line_units_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      name: "order_line_units_organization_order_line_fk",
      columns: [table.organizationId, table.orderLineId],
      foreignColumns: [orderLines.organizationId, orderLines.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_line_units_organization_stock_unit_fk",
      columns: [table.organizationId, table.stockUnitId],
      foreignColumns: [stockUnits.organizationId, stockUnits.id],
    }).onDelete("restrict"),
    uniqueIndex("order_line_units_line_unit_unique").on(
      table.organizationId,
      table.orderLineId,
      table.stockUnitId,
    ),
    uniqueIndex("order_line_units_active_stock_unit_unique")
      .on(table.organizationId, table.stockUnitId)
      .where(sql`${table.status} in ('reserved', 'fulfilled')`),
    index("order_line_units_line_status_idx").on(
      table.organizationId,
      table.orderLineId,
      table.status,
    ),
    check(
      "order_line_units_status_check",
      sql`${table.status} in ('reserved', 'fulfilled', 'returned')`,
    ),
    check(
      "order_line_units_timestamps_check",
      sql`(${table.status} = 'reserved' and ${table.fulfilledAt} is null and ${table.returnedAt} is null) or (${table.status} = 'fulfilled' and ${table.fulfilledAt} is not null and ${table.returnedAt} is null) or (${table.status} = 'returned' and ${table.fulfilledAt} is not null and ${table.returnedAt} is not null)`,
    ),
  ],
);

export const orderShipments = pgTable(
  "order_shipments",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    carrierCode: varchar("carrier_code", { length: 40 }).notNull(),
    service: varchar("service", { length: 120 }),
    trackingNumber: varchar("tracking_number", { length: 180 }),
    trackingUrl: varchar("tracking_url", { length: 2_048 }),
    status: varchar("status", { length: 24 })
      .$type<ShipmentStatus>()
      .notNull()
      .default("draft"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    response: jsonb("response")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_shipments_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("order_shipments_idempotency_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    uniqueIndex("order_shipments_tracking_unique")
      .on(table.organizationId, table.carrierCode, table.trackingNumber)
      .where(sql`${table.trackingNumber} is not null`),
    foreignKey({
      name: "order_shipments_organization_order_fk",
      columns: [table.organizationId, table.orderId],
      foreignColumns: [orders.organizationId, orders.id],
    }).onDelete("cascade"),
    index("order_shipments_order_status_idx").on(
      table.organizationId,
      table.orderId,
      table.status,
    ),
    index("order_shipments_status_shipped_idx").on(
      table.organizationId,
      table.status,
      table.shippedAt,
    ),
    check(
      "order_shipments_status_check",
      sql`${table.status} in ('draft', 'ready', 'shipped', 'in_transit', 'delivered', 'exception', 'returned', 'cancelled')`,
    ),
    check(
      "order_shipments_carrier_code_check",
      sql`${table.carrierCode} ~ '^[a-z0-9][a-z0-9_-]{0,39}$'`,
    ),
    check(
      "order_shipments_tracking_number_nonempty",
      sql`${table.trackingNumber} is null or length(btrim(${table.trackingNumber})) > 0`,
    ),
    check(
      "order_shipments_shipped_timestamp_check",
      sql`(${table.status} in ('draft', 'ready', 'cancelled') and ${table.shippedAt} is null) or (${table.status} in ('shipped', 'in_transit', 'delivered', 'exception', 'returned') and ${table.shippedAt} is not null)`,
    ),
    check(
      "order_shipments_delivered_timestamp_check",
      sql`${table.status} <> 'delivered' or ${table.deliveredAt} is not null`,
    ),
    check(
      "order_shipments_timestamp_order_check",
      sql`${table.deliveredAt} is null or ${table.shippedAt} is null or ${table.deliveredAt} >= ${table.shippedAt}`,
    ),
  ],
);

export const orderShipmentLines = pgTable(
  "order_shipment_lines",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    shipmentId: uuid("shipment_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_shipment_lines_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("order_shipment_lines_shipment_order_line_unique").on(
      table.organizationId,
      table.shipmentId,
      table.orderLineId,
    ),
    foreignKey({
      name: "order_shipment_lines_organization_shipment_fk",
      columns: [table.organizationId, table.shipmentId],
      foreignColumns: [orderShipments.organizationId, orderShipments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_shipment_lines_organization_order_line_fk",
      columns: [table.organizationId, table.orderLineId],
      foreignColumns: [orderLines.organizationId, orderLines.id],
    }).onDelete("restrict"),
    index("order_shipment_lines_order_line_idx").on(
      table.organizationId,
      table.orderLineId,
    ),
    check("order_shipment_lines_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

export const orderShipmentUnits = pgTable(
  "order_shipment_units",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    shipmentLineId: uuid("shipment_line_id").notNull(),
    orderLineUnitId: uuid("order_line_unit_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_shipment_units_line_unit_unique").on(
      table.organizationId,
      table.shipmentLineId,
      table.orderLineUnitId,
    ),
    foreignKey({
      name: "order_shipment_units_organization_shipment_line_fk",
      columns: [table.organizationId, table.shipmentLineId],
      foreignColumns: [orderShipmentLines.organizationId, orderShipmentLines.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_shipment_units_organization_order_line_unit_fk",
      columns: [table.organizationId, table.orderLineUnitId],
      foreignColumns: [orderLineUnits.organizationId, orderLineUnits.id],
    }).onDelete("restrict"),
    index("order_shipment_units_order_line_unit_idx").on(
      table.organizationId,
      table.orderLineUnitId,
    ),
  ],
);

export const orderShipmentEvents = pgTable(
  "order_shipment_events",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    shipmentId: uuid("shipment_id").notNull(),
    fromStatus: varchar("from_status", { length: 24 }).$type<ShipmentStatus>(),
    toStatus: varchar("to_status", { length: 24 })
      .$type<ShipmentStatus>()
      .notNull(),
    note: text("note").notNull().default(""),
    actor: varchar("actor", { length: 320 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "order_shipment_events_organization_shipment_fk",
      columns: [table.organizationId, table.shipmentId],
      foreignColumns: [orderShipments.organizationId, orderShipments.id],
    }).onDelete("cascade"),
    index("order_shipment_events_shipment_occurred_idx").on(
      table.organizationId,
      table.shipmentId,
      table.occurredAt,
    ),
    check(
      "order_shipment_events_from_status_check",
      sql`${table.fromStatus} is null or ${table.fromStatus} in ('draft', 'ready', 'shipped', 'in_transit', 'delivered', 'exception', 'returned', 'cancelled')`,
    ),
    check(
      "order_shipment_events_to_status_check",
      sql`${table.toStatus} in ('draft', 'ready', 'shipped', 'in_transit', 'delivered', 'exception', 'returned', 'cancelled')`,
    ),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id"),
    variantDelta: integer("variant_delta"),
    variantBalanceAfter: integer("variant_balance_after"),
    unitId: uuid("unit_id").references(() => stockUnits.id, {
      onDelete: "set null",
    }),
    assemblyBuildId: uuid("assembly_build_id").references(
      () => assemblyBuilds.id,
      { onDelete: "set null" },
    ),
    purchaseReceiptId: uuid("purchase_receipt_id").references(
      () => purchaseReceipts.id,
      { onDelete: "set null" },
    ),
    orderLineId: uuid("order_line_id").references(() => orderLines.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id"),
    delta: integer("delta").notNull(),
    quantity: integer("quantity").notNull().default(0),
    totalPriceCents: integer("total_price_cents"),
    priceCurrency: varchar("price_currency", { length: 3 }),
    costCents: integer("cost_cents"),
    costCurrency: varchar("cost_currency", { length: 3 }),
    costEstimated: boolean("cost_estimated").notNull().default(false),
    balanceAfter: integer("balance_after").notNull(),
    fromLocationBalanceAfter: integer("from_location_balance_after"),
    toLocationBalanceAfter: integer("to_location_balance_after"),
    type: varchar("type", { length: 48 }).notNull().default("adjustment"),
    reason: varchar("reason", { length: 240 }),
    note: text("note").notNull().default(""),
    location: varchar("location", { length: 240 }),
    fromLocationResourceId: uuid("from_location_resource_id").references(
      () => resources.id,
      { onDelete: "set null" },
    ),
    toLocationResourceId: uuid("to_location_resource_id").references(
      () => resources.id,
      { onDelete: "set null" },
    ),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: varchar("created_by", { length: 320 }),
  },
  (table) => [
    foreignKey({
      name: "stock_movements_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_movements_organization_contact_fk",
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }),
    index("stock_movements_resource_id_idx").on(table.resourceId),
    index("stock_movements_variant_id_idx").on(table.variantId),
    foreignKey({
      name: "stock_movements_variant_resource_fk",
      columns: [table.variantId, table.resourceId],
      foreignColumns: [resourceVariants.id, resourceVariants.resourceId],
    }).onDelete("restrict"),
    index("stock_movements_resource_occurred_idx").on(
      table.resourceId,
      table.occurredAt,
    ),
    index("stock_movements_unit_id_idx").on(table.unitId),
    index("stock_movements_assembly_build_id_idx").on(table.assemblyBuildId),
    index("stock_movements_purchase_receipt_id_idx").on(
      table.purchaseReceiptId,
    ),
    index("stock_movements_order_line_id_idx").on(table.orderLineId),
    index("stock_movements_contact_id_idx").on(
      table.organizationId,
      table.contactId,
    ),
    index("stock_movements_from_location_idx").on(table.fromLocationResourceId),
    index("stock_movements_to_location_idx").on(table.toLocationResourceId),
    check(
      "stock_movements_quantity_nonnegative",
      sql`${table.quantity} >= 0`,
    ),
    check(
      "stock_movements_cost_nonnegative",
      sql`${table.costCents} is null or ${table.costCents} >= 0`,
    ),
    check(
      "stock_movements_price_fields_together",
      sql`(${table.totalPriceCents} is null and ${table.priceCurrency} is null) or (${table.totalPriceCents} is not null and ${table.priceCurrency} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "stock_movements_cost_fields_together",
      sql`(${table.costCents} is null and ${table.costCurrency} is null) or (${table.costCents} is not null and ${table.costCurrency} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "stock_movements_variant_fields_consistent",
      sql`(${table.variantId} is null and ${table.variantDelta} is null and ${table.variantBalanceAfter} is null) or (${table.variantId} is not null and ${table.variantDelta} is not null and ${table.variantBalanceAfter} is not null)`,
    ),
  ],
);

export const stockCostLayers = pgTable(
  "stock_cost_layers",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    sourceMovementId: uuid("source_movement_id").references(
      () => stockMovements.id,
      { onDelete: "set null" },
    ),
    unitId: uuid("unit_id").references(() => stockUnits.id, {
      onDelete: "set null",
    }),
    initialQuantity: integer("initial_quantity").notNull(),
    remainingQuantity: integer("remaining_quantity").notNull(),
    initialCostCents: integer("initial_cost_cents"),
    remainingCostCents: integer("remaining_cost_cents"),
    currency: varchar("currency", { length: 3 }).notNull(),
    estimated: boolean("estimated").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "stock_cost_layers_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    index("stock_cost_layers_fifo_idx").on(
      table.organizationId,
      table.resourceId,
      table.occurredAt,
      table.createdAt,
    ),
    index("stock_cost_layers_source_movement_idx").on(table.sourceMovementId),
    index("stock_cost_layers_unit_idx").on(table.unitId),
    check("stock_cost_layers_initial_quantity_positive", sql`${table.initialQuantity} > 0`),
    check(
      "stock_cost_layers_remaining_quantity_range",
      sql`${table.remainingQuantity} between 0 and ${table.initialQuantity}`,
    ),
    check(
      "stock_cost_layers_initial_cost_nonnegative",
      sql`${table.initialCostCents} is null or ${table.initialCostCents} >= 0`,
    ),
    check(
      "stock_cost_layers_remaining_cost_valid",
      sql`(${table.initialCostCents} is null and ${table.remainingCostCents} is null) or (${table.initialCostCents} is not null and ${table.remainingCostCents} between 0 and ${table.initialCostCents})`,
    ),
    check("stock_cost_layers_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const stockCostAllocations = pgTable(
  "stock_cost_allocations",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => stockMovements.id, { onDelete: "cascade" }),
    layerId: uuid("layer_id")
      .notNull()
      .references(() => stockCostLayers.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    costCents: integer("cost_cents"),
    currency: varchar("currency", { length: 3 }).notNull(),
    estimated: boolean("estimated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_cost_allocations_movement_layer_unique").on(
      table.movementId,
      table.layerId,
    ),
    index("stock_cost_allocations_movement_idx").on(table.movementId),
    index("stock_cost_allocations_layer_idx").on(table.layerId),
    check("stock_cost_allocations_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "stock_cost_allocations_cost_nonnegative",
      sql`${table.costCents} is null or ${table.costCents} >= 0`,
    ),
    check("stock_cost_allocations_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const inventoryCounts = pgTable(
  "inventory_counts",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    locationResourceId: uuid("location_resource_id").references(
      () => resources.id,
      { onDelete: "set null" },
    ),
    expectedQuantity: integer("expected_quantity").notNull(),
    countedQuantity: integer("counted_quantity").notNull(),
    variance: integer("variance").notNull(),
    countedAt: timestamp("counted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    note: text("note").notNull().default(""),
    movementId: uuid("movement_id").references(() => stockMovements.id, {
      onDelete: "set null",
    }),
    idempotencyKey: uuid("idempotency_key"),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("inventory_counts_idempotency_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("inventory_counts_resource_counted_idx").on(
      table.resourceId,
      table.countedAt,
    ),
    index("inventory_counts_location_idx").on(table.locationResourceId),
    check(
      "inventory_counts_expected_nonnegative",
      sql`${table.expectedQuantity} >= 0`,
    ),
    check(
      "inventory_counts_counted_nonnegative",
      sql`${table.countedQuantity} >= 0`,
    ),
    check(
      "inventory_counts_variance_consistent",
      sql`${table.variance} = ${table.countedQuantity} - ${table.expectedQuantity}`,
    ),
  ],
);

export const inventoryAssignments = pgTable(
  "inventory_assignments",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    stockUnitId: uuid("stock_unit_id").references(() => stockUnits.id, {
      onDelete: "restrict",
    }),
    internalRequestLineId: uuid("internal_request_line_id").references(
      () => internalRequestLines.id,
      { onDelete: "restrict" },
    ),
    kind: varchar("kind", { length: 24 })
      .$type<AssignmentKind>()
      .notNull(),
    status: varchar("status", { length: 24 })
      .$type<AssignmentStatus>()
      .notNull()
      .default("active"),
    stockApplied: boolean("stock_applied").notNull().default(true),
    quantity: integer("quantity").notNull().default(1),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assigneeResourceId: uuid("assignee_resource_id").references(
      () => resources.id,
      { onDelete: "set null" },
    ),
    assigneeLabel: varchar("assignee_label", { length: 240 }).notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    createdBy: varchar("created_by", { length: 320 }),
    completedBy: varchar("completed_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "inventory_assignments_organization_internal_request_line_fk",
      columns: [table.organizationId, table.internalRequestLineId],
      foreignColumns: [
        internalRequestLines.organizationId,
        internalRequestLines.id,
      ],
    }).onDelete("restrict"),
    index("inventory_assignments_resource_status_idx").on(
      table.resourceId,
      table.status,
    ),
    index("inventory_assignments_due_idx").on(table.status, table.dueAt),
    index("inventory_assignments_stock_unit_idx").on(table.stockUnitId),
    index("inventory_assignments_internal_request_line_idx").on(
      table.internalRequestLineId,
    ),
    index("inventory_assignments_assignee_user_idx").on(table.assigneeUserId),
    index("inventory_assignments_assignee_resource_idx").on(
      table.assigneeResourceId,
    ),
    uniqueIndex("inventory_assignments_active_stock_unit_unique")
      .on(table.stockUnitId)
      .where(
        sql`${table.stockUnitId} is not null and ${table.status} = 'active'`,
      ),
    check(
      "inventory_assignments_kind_check",
      sql`${table.kind} in ('checkout', 'assignment', 'reservation')`,
    ),
    check(
      "inventory_assignments_status_check",
      sql`${table.status} in ('active', 'returned', 'cancelled')`,
    ),
    check(
      "inventory_assignments_quantity_positive",
      sql`${table.quantity} > 0`,
    ),
    check(
      "inventory_assignments_serialized_quantity_one",
      sql`${table.stockUnitId} is null or ${table.quantity} = 1`,
    ),
    check(
      "inventory_assignments_exactly_one_assignee",
      sql`num_nonnulls(${table.assigneeUserId}, ${table.assigneeResourceId}, nullif(${table.assigneeLabel}, '')) = 1`,
    ),
  ],
);

export const assemblyBuildComponents = pgTable(
  "assembly_build_components",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    buildId: uuid("build_id")
      .notNull()
      .references(() => assemblyBuilds.id, { onDelete: "cascade" }),
    componentResourceId: uuid("component_resource_id").references(
      () => resources.id,
      { onDelete: "restrict" },
    ),
    componentName: varchar("component_name", { length: 240 }).notNull(),
    componentSku: varchar("component_sku", { length: 80 }),
    quantityPerAssembly: integer("quantity_per_assembly").notNull(),
    quantityConsumed: integer("quantity_consumed").notNull(),
    costCents: integer("cost_cents"),
    costCurrency: varchar("cost_currency", { length: 3 }),
    costEstimated: boolean("cost_estimated").notNull().default(false),
    componentUnitId: uuid("component_unit_id").references(
      () => stockUnits.id,
      { onDelete: "restrict" },
    ),
    outputUnitId: uuid("output_unit_id").references(() => stockUnits.id, {
      onDelete: "set null",
    }),
    stockMovementId: uuid("stock_movement_id").references(
      () => stockMovements.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("assembly_build_components_build_id_idx").on(table.buildId),
    index("assembly_build_components_component_resource_id_idx").on(
      table.componentResourceId,
    ),
    index("assembly_build_components_component_unit_id_idx").on(
      table.componentUnitId,
    ),
    index("assembly_build_components_output_unit_id_idx").on(
      table.outputUnitId,
    ),
    index("assembly_build_components_stock_movement_id_idx").on(
      table.stockMovementId,
    ),
    check(
      "assembly_build_components_quantity_per_assembly_positive",
      sql`${table.quantityPerAssembly} > 0`,
    ),
    check(
      "assembly_build_components_quantity_consumed_positive",
      sql`${table.quantityConsumed} > 0`,
    ),
    check(
      "assembly_build_components_cost_nonnegative",
      sql`${table.costCents} is null or ${table.costCents} >= 0`,
    ),
    check(
      "assembly_build_components_cost_fields_together",
      sql`(${table.costCents} is null and ${table.costCurrency} is null) or (${table.costCents} is not null and ${table.costCurrency} ~ '^[A-Z]{3}$')`,
    ),
  ],
);

export const stockMovementRequests = pgTable(
  "stock_movement_requests",
  {
    organizationId: organizationIdColumn(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    resourceId: uuid("resource_id").notNull(),
    actor: varchar("actor", { length: 320 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "stock_movement_requests_pk",
      columns: [table.organizationId, table.idempotencyKey],
    }),
    index("stock_movement_requests_resource_id_idx").on(table.resourceId),
  ],
);

export const stockScanWorkflows = pgTable(
  "stock_scan_workflows",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    resourceIds: uuid("target_resource_ids")
      .array()
      .notNull()
      .default([]),
    targetSelectionMode: varchar("target_selection_mode", { length: 16 })
      .$type<"all" | "radio" | "checkbox">()
      .notNull()
      .default("all"),
    allowVariantSelection: boolean("allow_variant_selection")
      .notNull()
      .default(false),
    codeTypes: text("code_types")
      .array()
      .$type<ScanCodeType[]>()
      .notNull()
      .default([...scanCodeTypes]),
    publicTriggerEnabled: boolean("public_trigger_enabled")
      .notNull()
      .default(false),
    publicTriggerId: uuid("public_trigger_id").notNull().defaultRandom(),
    publicTriggerCode: text("public_trigger_code"),
    quantityInputKey: varchar("quantity_input_key", { length: 80 }),
    revision: integer("revision").notNull().default(1),
    extraction: jsonb("extraction")
      .$type<ScanWorkflowExtraction>()
      .notNull(),
    identifierPropertyKey: varchar("identifier_property_key", {
      length: 80,
    }).notNull(),
    identifierStorage: varchar("identifier_storage", { length: 24 })
      .$type<"custom-field" | "metadata" | "execution">()
      .notNull()
      .default("custom-field"),
    extractedFields: jsonb("extracted_fields")
      .$type<ScanWorkflowExtractedField[]>()
      .notNull()
      .default([]),
    operation: jsonb("operation")
      .$type<ScanWorkflowOperation>()
      .notNull()
      .default({ type: "unit" }),
    createMissingUnit: boolean("create_missing_unit").notNull().default(false),
    unitStatus: varchar("unit_status", { length: 32 }).$type<StockUnitStatus>(),
    fixedProperties: jsonb("fixed_properties")
      .$type<ScanWorkflowFixedProperty[]>()
      .notNull()
      .default([]),
    inputFields: jsonb("input_fields")
      .$type<ScanWorkflowInputField[]>()
      .notNull()
      .default([]),
    triggerWebhook: boolean("trigger_webhook").notNull().default(false),
    webhookEventName: varchar("webhook_event_name", { length: 120 })
      .notNull()
      .default("inventory.action.executed"),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("stock_scan_workflows_resource_id_idx").on(table.resourceId),
    index("stock_scan_workflows_enabled_idx").on(table.enabled),
    uniqueIndex("stock_scan_workflows_public_trigger_id_unique").on(
      table.publicTriggerId,
    ),
    check("stock_scan_workflows_revision_positive", sql`${table.revision} > 0`),
    check(
      "stock_scan_workflows_code_types_nonempty",
      sql`cardinality(${table.codeTypes}) > 0`,
    ),
    check(
      "stock_scan_workflows_target_resource_ids_nonempty",
      sql`cardinality(${table.resourceIds}) > 0`,
    ),
    check(
      "stock_scan_workflows_target_selection_mode_check",
      sql`${table.targetSelectionMode} in ('all', 'radio', 'checkbox')`,
    ),
    check(
      "stock_scan_workflows_code_types_check",
      sql`${table.codeTypes} <@ array['qr_code', 'data_matrix', 'aztec', 'pdf417', 'code_128', 'code_93', 'code_39', 'codabar', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf']::text[]`,
    ),
    check(
      "stock_scan_workflows_unit_status_check",
      sql`${table.unitStatus} is null or ${table.unitStatus} in ('available', 'reserved', 'in-use', 'maintenance', 'consumed', 'lost', 'retired')`,
    ),
    check(
      "stock_scan_workflows_extraction_object",
      sql`jsonb_typeof(${table.extraction}) = 'object'`,
    ),
    check(
      "stock_scan_workflows_identifier_storage_check",
      sql`${table.identifierStorage} in ('custom-field', 'metadata', 'execution')`,
    ),
    check(
      "stock_scan_workflows_extracted_fields_array",
      sql`jsonb_typeof(${table.extractedFields}) = 'array'`,
    ),
    check(
      "stock_scan_workflows_operation_object",
      sql`jsonb_typeof(${table.operation}) = 'object'`,
    ),
    check(
      "stock_scan_workflows_fixed_properties_array",
      sql`jsonb_typeof(${table.fixedProperties}) = 'array'`,
    ),
    check(
      "stock_scan_workflows_input_fields_array",
      sql`jsonb_typeof(${table.inputFields}) = 'array'`,
    ),
  ],
);

export const stockScanExecutions = pgTable(
  "stock_scan_executions",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    workflowId: uuid("workflow_id").references(() => stockScanWorkflows.id, {
      onDelete: "set null",
    }),
    workflowRevision: integer("workflow_revision").notNull(),
    resourceId: uuid("resource_id").references(() => resources.id, {
      onDelete: "set null",
    }),
    unitId: uuid("unit_id").references(() => stockUnits.id, {
      onDelete: "set null",
    }),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    codeType: varchar("code_type", { length: 32 }).$type<ScanCodeType>(),
    actor: varchar("actor", { length: 320 }).notNull(),
    createdUnit: boolean("created_unit").notNull().default(false),
    beforeMetadata: jsonb("before_metadata").$type<Record<string, unknown>>(),
    afterMetadata: jsonb("after_metadata")
      .$type<Record<string, unknown>>()
      .notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_scan_executions_idempotency_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("stock_scan_executions_workflow_id_idx").on(table.workflowId),
    index("stock_scan_executions_resource_id_idx").on(table.resourceId),
    index("stock_scan_executions_unit_id_idx").on(table.unitId),
    check(
      "stock_scan_executions_workflow_revision_positive",
      sql`${table.workflowRevision} > 0`,
    ),
    check(
      "stock_scan_executions_code_type_check",
      sql`${table.codeType} is null or ${table.codeType} in ('qr_code', 'data_matrix', 'aztec', 'pdf417', 'code_128', 'code_93', 'code_39', 'codabar', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf')`,
    ),
    check(
      "stock_scan_executions_before_metadata_object",
      sql`${table.beforeMetadata} is null or jsonb_typeof(${table.beforeMetadata}) = 'object'`,
    ),
    check(
      "stock_scan_executions_after_metadata_object",
      sql`jsonb_typeof(${table.afterMetadata}) = 'object'`,
    ),
    check(
      "stock_scan_executions_response_object",
      sql`jsonb_typeof(${table.response}) = 'object'`,
    ),
  ],
);

export const media = pgTable(
  "media",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    url: text("url").notNull(),
    name: varchar("name", { length: 280 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }).notNull(),
    kind: varchar("kind", { length: 24 })
      .$type<MediaKind>()
      .notNull()
      .default("image"),
    size: integer("size").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    position: integer("position").notNull().default(0),
    altText: text("alt_text").notNull().default(""),
    source: varchar("source", { length: 24 }).notNull().default("upload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "media_organization_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("cascade"),
    index("media_resource_id_idx").on(table.resourceId),
    index("media_resource_position_idx").on(table.resourceId, table.position),
  ],
);

export const publicShares = pgTable(
  "public_shares",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    scope: varchar("scope", { length: 16 }).$type<PublicShareScope>().notNull(),
    accessMode: varchar("access_mode", { length: 16 })
      .$type<PublicShareAccessMode>()
      .notNull()
      .default("view"),
    passwordHash: varchar("password_hash", { length: 255 }),
    resourceId: uuid("resource_id").references(() => resources.id, {
      onDelete: "cascade",
    }),
    filter: jsonb("filter").$type<PublicShareFilter>(),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("public_shares_active_created_at_idx").on(
      table.revokedAt,
      table.createdAt,
    ),
    index("public_shares_resource_id_idx").on(table.resourceId),
    check(
      "public_shares_scope_check",
      sql`${table.scope} in ('inventory', 'item')`,
    ),
    check(
      "public_shares_access_mode_check",
      sql`${table.accessMode} in ('view', 'stock')`,
    ),
    check(
      "public_shares_stock_tool_check",
      sql`(
        ${table.accessMode} = 'view'
        and ${table.passwordHash} is null
      ) or (
        ${table.accessMode} = 'stock'
        and ${table.scope} = 'inventory'
        and ${table.passwordHash} is not null
      )`,
    ),
    check(
      "public_shares_scope_target_check",
      sql`(
        ${table.scope} = 'inventory'
        and ${table.resourceId} is null
      ) or (
        ${table.scope} = 'item'
        and ${table.resourceId} is not null
        and ${table.filter} is null
      )`,
    ),
    check(
      "public_shares_filter_object",
      sql`${table.filter} is null or jsonb_typeof(${table.filter}) = 'object'`,
    ),
    check(
      "public_shares_filter_shape",
      sql`${table.filter} is null or (
        ${table.filter} ? 'fieldKey'
        and ${table.filter} ? 'value'
        and (${table.filter} - 'fieldKey' - 'value') = '{}'::jsonb
        and jsonb_typeof(${table.filter} -> 'fieldKey') = 'string'
        and (${table.filter} ->> 'fieldKey') ~ '^[a-z][a-z0-9_]{0,63}$'
        and jsonb_typeof(${table.filter} -> 'value') in ('string', 'number', 'boolean', 'array')
      )`,
    ),
  ],
);

export const mediaUploadBatches = pgTable(
  "media_upload_batches",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("media_upload_batches_idempotency_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("media_upload_batches_resource_id_idx").on(table.resourceId),
  ],
);

export const mediaUploadBatchItems = pgTable(
  "media_upload_batch_items",
  {
    organizationId: organizationIdColumn(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => mediaUploadBatches.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .primaryKey()
      .references(() => media.id, { onDelete: "cascade" }),
  },
  (table) => [index("media_upload_batch_items_batch_id_idx").on(table.batchId)],
);

export const aiIdempotencyOperations = pgTable(
  "ai_idempotency_operations",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    operation: varchar("operation", { length: 24 })
      .$type<
        "analyze" | "research" | "recognize" | "count" | "cover" | "translate"
      >()
      .notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    resourceId: uuid("resource_id").notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<"processing" | "completed" | "failed">()
      .notNull()
      .default("processing"),
    responseStatus: integer("response_status"),
    response: jsonb("response").$type<Record<string, unknown>>(),
    responseHeaders: jsonb("response_headers")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_idempotency_operations_operation_key_unique").on(
      table.organizationId,
      table.operation,
      table.idempotencyKey,
    ),
    index("ai_idempotency_operations_resource_id_idx").on(table.resourceId),
    check(
      "ai_idempotency_operations_operation_check",
      sql`${table.operation} in ('analyze', 'research', 'recognize', 'count', 'cover', 'translate')`,
    ),
    check(
      "ai_idempotency_operations_status_check",
      sql`${table.status} in ('processing', 'completed', 'failed')`,
    ),
  ],
);

export const aiRateLimitBuckets = pgTable(
  "ai_rate_limit_buckets",
  {
    organizationId: organizationIdColumn(),
    operation: varchar("operation", { length: 24 })
      .$type<PaidAiOperation>()
      .notNull(),
    subjectHash: varchar("subject_hash", { length: 64 }).notNull(),
    requestCount: integer("request_count").notNull().default(1),
    resetsAt: timestamp("resets_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "ai_rate_limit_buckets_operation_subject_pk",
      columns: [table.organizationId, table.operation, table.subjectHash],
    }),
    check(
      "ai_rate_limit_buckets_operation_check",
      sql`${table.operation} in ('analyze', 'research', 'recognize', 'count', 'cover', 'translate')`,
    ),
    check(
      "ai_rate_limit_buckets_request_count_positive",
      sql`${table.requestCount} > 0`,
    ),
    check(
      "ai_rate_limit_buckets_subject_hash_check",
      sql`${table.subjectHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    action: varchar("action", { length: 40 }).$type<AiBillableAction>().notNull(),
    provider: varchar("provider", { length: 24 }).$type<AiUsageProvider>().notNull(),
    model: varchar("model", { length: 240 }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<"running" | "succeeded" | "failed">()
      .notNull()
      .default("running"),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull(),
    costEstimated: boolean("cost_estimated").notNull().default(true),
    actor: varchar("actor", { length: 320 }).notNull(),
    actorName: varchar("actor_name", { length: 160 }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    tokenId: uuid("token_id"),
    resourceId: uuid("resource_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("ai_usage_events_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("ai_usage_events_org_action_created_idx").on(
      table.organizationId,
      table.action,
      table.createdAt,
    ),
    check(
      "ai_usage_events_action_check",
      sql`${table.action} in ('inventory_analysis', 'inventory_research', 'image_search', 'inventory_recognition', 'photo_count', 'image_generation', 'translation', 'room_analysis', 'workflow_extraction')`,
    ),
    check(
      "ai_usage_events_provider_check",
      sql`${table.provider} in ('openai', 'google', 'replicate')`,
    ),
    check(
      "ai_usage_events_status_check",
      sql`${table.status} in ('running', 'succeeded', 'failed')`,
    ),
    check("ai_usage_events_cost_nonnegative", sql`${table.costMicros} >= 0`),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    organizationId: organizationIdColumn(),
    recipientKey: varchar("recipient_key", { length: 320 }).notNull(),
    recipientEmail: varchar("recipient_email", { length: 320 }),
    recipientName: varchar("recipient_name", { length: 160 }),
    enabledEventTypes: text("enabled_event_types")
      .array()
      .$type<NotificationEventType[]>()
      .notNull()
      .default(["low_stock", "expiry", "maintenance", "return_due"]),
    frequency: varchar("frequency", { length: 24 })
      .$type<NotificationFrequency>()
      .notNull()
      .default("daily"),
    digestHour: integer("digest_hour").notNull().default(8),
    timezone: varchar("timezone", { length: 80 }).notNull().default("UTC"),
    locale: varchar("locale", { length: 8 })
      .$type<NotificationLocale>()
      .notNull()
      .default("en"),
    cooldownHours: integer("cooldown_hours").notNull().default(24),
    lowStockThresholdPercent: integer("low_stock_threshold_percent")
      .notNull()
      .default(100),
    expiryWindowDays: integer("expiry_window_days").notNull().default(30),
    expiryFieldKey: varchar("expiry_field_key", { length: 120 })
      .notNull()
      .default("expiry_date"),
    maintenanceWindowDays: integer("maintenance_window_days")
      .notNull()
      .default(7),
    maintenanceFieldKey: varchar("maintenance_field_key", { length: 120 })
      .notNull()
      .default("maintenance_due"),
    returnDueWindowDays: integer("return_due_window_days")
      .notNull()
      .default(3),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    pushEnabled: boolean("push_enabled").notNull().default(false),
    slackEnabled: boolean("slack_enabled").notNull().default(false),
    teamsEnabled: boolean("teams_enabled").notNull().default(false),
    webhookEnabled: boolean("webhook_enabled").notNull().default(false),
    lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "notification_preferences_organization_recipient_pk",
      columns: [table.organizationId, table.recipientKey],
    }),
    check(
      "notification_preferences_event_types_check",
      sql`${table.enabledEventTypes} <@ array['low_stock', 'expiry', 'maintenance', 'return_due']::text[]`,
    ),
    check(
      "notification_preferences_frequency_check",
      sql`${table.frequency} in ('daily', 'immediate')`,
    ),
    check(
      "notification_preferences_digest_hour_check",
      sql`${table.digestHour} between 0 and 23`,
    ),
    check(
      "notification_preferences_locale_check",
      sql`${table.locale} in ('en', 'de')`,
    ),
    check(
      "notification_preferences_cooldown_check",
      sql`${table.cooldownHours} between 1 and 720`,
    ),
    check(
      "notification_preferences_low_stock_threshold_check",
      sql`${table.lowStockThresholdPercent} between 1 and 500`,
    ),
    check(
      "notification_preferences_expiry_window_check",
      sql`${table.expiryWindowDays} between 0 and 3650`,
    ),
    check(
      "notification_preferences_maintenance_window_check",
      sql`${table.maintenanceWindowDays} between 0 and 3650`,
    ),
    check(
      "notification_preferences_return_due_window_check",
      sql`${table.returnDueWindowDays} between 0 and 365`,
    ),
  ],
);

export const notificationInbox = pgTable(
  "notification_inbox",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    recipientKey: varchar("recipient_key", { length: 320 }).notNull(),
    eventType: varchar("event_type", { length: 32 })
      .$type<NotificationEventType>()
      .notNull(),
    resourceId: uuid("resource_id").references(() => resources.id, {
      onDelete: "set null",
    }),
    assignmentId: uuid("assignment_id").references(
      () => inventoryAssignments.id,
      { onDelete: "set null" },
    ),
    sourceKey: varchar("source_key", { length: 420 }).notNull(),
    dedupeBucket: varchar("dedupe_bucket", { length: 64 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    body: text("body").notNull(),
    href: varchar("href", { length: 500 }),
    metadata: jsonb("metadata")
      .$type<NotificationMetadata>()
      .notNull()
      .default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "notification_inbox_preference_fk",
      columns: [table.organizationId, table.recipientKey],
      foreignColumns: [
        notificationPreferences.organizationId,
        notificationPreferences.recipientKey,
      ],
    }).onDelete("cascade"),
    uniqueIndex("notification_inbox_dedupe_unique").on(
      table.organizationId,
      table.recipientKey,
      table.eventType,
      table.sourceKey,
      table.dedupeBucket,
    ),
    index("notification_inbox_recipient_created_idx").on(
      table.recipientKey,
      table.createdAt,
    ),
    index("notification_inbox_recipient_unread_idx").on(
      table.recipientKey,
      table.readAt,
    ),
    check(
      "notification_inbox_event_type_check",
      sql`${table.eventType} in ('low_stock', 'expiry', 'maintenance', 'return_due')`,
    ),
    check(
      "notification_inbox_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
  ],
);

export const notificationDispatches = pgTable(
  "notification_dispatches",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    recipientKey: varchar("recipient_key", { length: 320 }).notNull(),
    channel: varchar("channel", { length: 24 })
      .$type<NotificationChannel>()
      .notNull(),
    dedupeKey: varchar("dedupe_key", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    eventCount: integer("event_count").notNull().default(0),
    targetRedacted: varchar("target_redacted", { length: 500 }),
    error: text("error"),
    preview: boolean("preview").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "notification_dispatches_preference_fk",
      columns: [table.organizationId, table.recipientKey],
      foreignColumns: [
        notificationPreferences.organizationId,
        notificationPreferences.recipientKey,
      ],
    }).onDelete("cascade"),
    index("notification_dispatches_recipient_created_idx").on(
      table.recipientKey,
      table.createdAt,
    ),
    uniqueIndex("notification_dispatches_dedupe_unique").on(
      table.organizationId,
      table.dedupeKey,
    ),
    check(
      "notification_dispatches_channel_check",
      sql`${table.channel} in ('email', 'push', 'slack', 'teams', 'webhook')`,
    ),
    check(
      "notification_dispatches_status_check",
      sql`${table.status} in ('sending', 'sent', 'skipped', 'failed', 'preview')`,
    ),
    check(
      "notification_dispatches_event_count_check",
      sql`${table.eventCount} >= 0`,
    ),
  ],
);

export const notificationPushSubscriptions = pgTable(
  "notification_push_subscriptions",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    recipientKey: varchar("recipient_key", { length: 320 }).notNull(),
    endpointHash: varchar("endpoint_hash", { length: 64 }).notNull(),
    encryptedSubscription: text("encrypted_subscription").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "notification_push_subscriptions_preference_fk",
      columns: [table.organizationId, table.recipientKey],
      foreignColumns: [
        notificationPreferences.organizationId,
        notificationPreferences.recipientKey,
      ],
    }).onDelete("cascade"),
    uniqueIndex("notification_push_subscriptions_endpoint_unique").on(
      table.organizationId,
      table.endpointHash,
    ),
    index("notification_push_subscriptions_recipient_idx").on(
      table.recipientKey,
      table.revokedAt,
    ),
    check(
      "notification_push_subscriptions_endpoint_hash_check",
      sql`${table.endpointHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const webhookDeliveryStatuses = [
  "pending",
  "processing",
  "succeeded",
  "failed",
] as const;
export type WebhookDeliveryStatus =
  (typeof webhookDeliveryStatuses)[number];

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    encryptedUrl: text("encrypted_url").notNull(),
    redactedUrl: varchar("redacted_url", { length: 500 }).notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    eventTypes: text("event_types")
      .array()
      .$type<WebhookSubscriptionEventType[]>()
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("webhook_endpoints_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    index("webhook_endpoints_active_idx").on(table.enabled, table.revokedAt),
    index("webhook_endpoints_revoked_idx")
      .on(table.revokedAt)
      .where(sql`${table.revokedAt} is not null`),
    check(
      "webhook_endpoints_event_types_nonempty",
      sql`cardinality(${table.eventTypes}) > 0`,
    ),
    check(
      "webhook_endpoints_event_types_check",
      sql`${table.eventTypes} <@ array['inventory.resource.created', 'inventory.resource.updated', 'inventory.resource.deleted', 'inventory.resource.merged', 'inventory.stock.movement.created', 'inventory.action.executed']::text[]`,
    ),
    check(
      "webhook_endpoints_failure_count_nonnegative",
      sql`${table.failureCount} >= 0`,
    ),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").primaryKey(),
    type: varchar("type", { length: 80 }).$type<WebhookEventType>().notNull(),
    apiVersion: varchar("api_version", { length: 8 }).notNull().default("1"),
    aggregateType: varchar("aggregate_type", { length: 80 }),
    aggregateId: varchar("aggregate_id", { length: 160 }),
    actor: varchar("actor", { length: 320 }),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    body: text("body").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_events_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    index("webhook_events_occurred_idx").on(table.occurredAt),
    index("webhook_events_created_idx").on(table.createdAt),
    index("webhook_events_aggregate_idx").on(
      table.aggregateType,
      table.aggregateId,
    ),
    check("webhook_events_api_version_check", sql`${table.apiVersion} = '1'`),
    check(
      "webhook_events_type_check",
      sql`${table.type} in ('inventory.resource.created', 'inventory.resource.updated', 'inventory.resource.deleted', 'inventory.resource.merged', 'inventory.stock.movement.created', 'inventory.action.executed', 'inventory.webhook.test')`,
    ),
    check(
      "webhook_events_payload_object",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => webhookEvents.id, { onDelete: "cascade" }),
    encryptedSecret: text("encrypted_secret").notNull(),
    status: varchar("status", { length: 24 })
      .$type<WebhookDeliveryStatus>()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    httpStatus: integer("http_status"),
    error: text("error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "webhook_deliveries_organization_endpoint_fk",
      columns: [table.organizationId, table.webhookId],
      foreignColumns: [webhookEndpoints.organizationId, webhookEndpoints.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "webhook_deliveries_organization_event_fk",
      columns: [table.organizationId, table.eventId],
      foreignColumns: [webhookEvents.organizationId, webhookEvents.id],
    }).onDelete("cascade"),
    uniqueIndex("webhook_deliveries_endpoint_event_unique").on(
      table.webhookId,
      table.eventId,
    ),
    index("webhook_deliveries_due_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("webhook_deliveries_event_idx").on(table.eventId),
    check(
      "webhook_deliveries_status_check",
      sql`${table.status} in ('pending', 'processing', 'succeeded', 'failed')`,
    ),
    check(
      "webhook_deliveries_attempts_nonnegative",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "webhook_deliveries_processing_lease_check",
      sql`(${table.status} = 'processing' and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'processing' and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "webhook_deliveries_http_status_check",
      sql`${table.httpStatus} is null or ${table.httpStatus} between 100 and 599`,
    ),
  ],
);

export const wooCommerceConnections = pgTable(
  "woocommerce_connections",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    storeUrl: varchar("store_url", { length: 2_048 }).notNull(),
    consumerKeyHint: varchar("consumer_key_hint", { length: 32 }).notNull(),
    encryptedConsumerKey: text("encrypted_consumer_key").notNull(),
    encryptedConsumerSecret: text("encrypted_consumer_secret").notNull(),
    syncEnabled: boolean("sync_enabled").notNull().default(false),
    encryptedWebhookSecret: text("encrypted_webhook_secret"),
    orderCreatedWebhookId: bigint("order_created_webhook_id", {
      mode: "number",
    }),
    orderUpdatedWebhookId: bigint("order_updated_webhook_id", {
      mode: "number",
    }),
    status: varchar("status", { length: 16 })
      .$type<"connected" | "error">()
      .notNull()
      .default("connected"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdBy: varchar("created_by", { length: 320 }),
    updatedBy: varchar("updated_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("woocommerce_connections_organization_unique").on(
      table.organizationId,
    ),
    uniqueIndex("woocommerce_connections_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    index("woocommerce_connections_status_idx").on(
      table.status,
      table.lastCheckedAt,
    ),
    check(
      "woocommerce_connections_status_check",
      sql`${table.status} in ('connected', 'error')`,
    ),
    check(
      "woocommerce_connections_sync_webhooks_check",
      sql`not ${table.syncEnabled} or (${table.encryptedWebhookSecret} is not null and ${table.orderCreatedWebhookId} is not null and ${table.orderUpdatedWebhookId} is not null)`,
    ),
  ],
);

export const wooCommerceCustomerLinks = pgTable(
  "woocommerce_customer_links",
  {
    organizationId: organizationIdColumn(),
    connectionId: uuid("connection_id").notNull(),
    customerKey: varchar("customer_key", { length: 400 }).notNull(),
    customerId: bigint("customer_id", { mode: "number" }),
    email: varchar("email", { length: 320 }),
    contactId: uuid("contact_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "woocommerce_customer_links_pk",
      columns: [
        table.organizationId,
        table.connectionId,
        table.customerKey,
      ],
    }),
    foreignKey({
      name: "woocommerce_customer_links_connection_fk",
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [
        wooCommerceConnections.organizationId,
        wooCommerceConnections.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "woocommerce_customer_links_contact_fk",
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete("cascade"),
    index("woocommerce_customer_links_contact_idx").on(
      table.organizationId,
      table.contactId,
    ),
    uniqueIndex("woocommerce_customer_links_customer_id_unique")
      .on(table.organizationId, table.connectionId, table.customerId)
      .where(sql`${table.customerId} is not null`),
    check(
      "woocommerce_customer_links_customer_id_check",
      sql`${table.customerId} is null or ${table.customerId} > 0`,
    ),
    check(
      "woocommerce_customer_links_email_normalized_check",
      sql`${table.email} is null or ${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
);

export const wooCommerceOrderSyncs = pgTable(
  "woocommerce_order_syncs",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").notNull(),
    contactId: uuid("contact_id"),
    localOrderId: uuid("local_order_id"),
    orderId: bigint("order_id", { mode: "number" }).notNull(),
    orderNumber: varchar("order_number", { length: 80 }).notNull(),
    orderStatus: varchar("order_status", { length: 80 }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<"succeeded" | "partial" | "failed">()
      .notNull()
      .default("succeeded"),
    totalLines: integer("total_lines").notNull().default(0),
    syncedLines: integer("synced_lines").notNull().default(0),
    lastDeliveryId: varchar("last_delivery_id", { length: 160 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "woocommerce_order_syncs_connection_fk",
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [
        wooCommerceConnections.organizationId,
        wooCommerceConnections.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "woocommerce_order_syncs_contact_fk",
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "woocommerce_order_syncs_local_order_fk",
      columns: [table.organizationId, table.localOrderId],
      foreignColumns: [orders.organizationId, orders.id],
    }).onDelete("restrict"),
    uniqueIndex("woocommerce_order_syncs_tenant_order_unique").on(
      table.organizationId,
      table.connectionId,
      table.orderId,
    ),
    uniqueIndex("woocommerce_order_syncs_local_order_unique")
      .on(table.organizationId, table.connectionId, table.localOrderId)
      .where(sql`${table.localOrderId} is not null`),
    index("woocommerce_order_syncs_contact_idx").on(
      table.organizationId,
      table.contactId,
    ),
    index("woocommerce_order_syncs_connection_updated_idx").on(
      table.organizationId,
      table.connectionId,
      table.updatedAt,
    ),
    index("woocommerce_order_syncs_issue_idx").on(
      table.organizationId,
      table.connectionId,
      table.status,
    ).where(sql`${table.status} <> 'succeeded'`),
    check(
      "woocommerce_order_syncs_status_check",
      sql`${table.status} in ('succeeded', 'partial', 'failed')`,
    ),
    check(
      "woocommerce_order_syncs_counts_check",
      sql`${table.totalLines} >= 0 and ${table.syncedLines} >= 0 and ${table.syncedLines} <= ${table.totalLines}`,
    ),
    check(
      "woocommerce_order_syncs_order_positive",
      sql`${table.orderId} > 0`,
    ),
  ],
);

export const wooCommerceOrderLineSyncs = pgTable(
  "woocommerce_order_line_syncs",
  {
    organizationId: organizationIdColumn(),
    connectionId: uuid("connection_id").notNull(),
    orderId: bigint("order_id", { mode: "number" }).notNull(),
    lineItemId: bigint("line_item_id", { mode: "number" }).notNull(),
    resourceId: uuid("resource_id"),
    variantId: uuid("variant_id"),
    localOrderLineId: uuid("local_order_line_id"),
    sku: varchar("sku", { length: 80 }).notNull().default(""),
    orderedQuantity: integer("ordered_quantity").notNull().default(0),
    refundedQuantity: integer("refunded_quantity").notNull().default(0),
    appliedQuantity: integer("applied_quantity").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    status: varchar("status", { length: 16 })
      .$type<"synced" | "unmapped" | "error">()
      .notNull()
      .default("synced"),
    lastMovementId: uuid("last_movement_id").references(
      () => stockMovements.id,
      { onDelete: "set null" },
    ),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "woocommerce_order_line_syncs_pk",
      columns: [
        table.organizationId,
        table.connectionId,
        table.orderId,
        table.lineItemId,
      ],
    }),
    foreignKey({
      name: "woocommerce_order_line_syncs_order_fk",
      columns: [table.organizationId, table.connectionId, table.orderId],
      foreignColumns: [
        wooCommerceOrderSyncs.organizationId,
        wooCommerceOrderSyncs.connectionId,
        wooCommerceOrderSyncs.orderId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "woocommerce_order_line_syncs_resource_fk",
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [resources.organizationId, resources.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "woocommerce_order_line_syncs_local_line_fk",
      columns: [table.organizationId, table.localOrderLineId],
      foreignColumns: [orderLines.organizationId, orderLines.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "woocommerce_order_line_syncs_variant_fk",
      columns: [table.variantId, table.resourceId],
      foreignColumns: [resourceVariants.id, resourceVariants.resourceId],
    }).onDelete("restrict"),
    index("woocommerce_order_line_syncs_resource_idx").on(
      table.organizationId,
      table.resourceId,
    ),
    uniqueIndex("woocommerce_order_line_syncs_local_line_unique")
      .on(
        table.organizationId,
        table.connectionId,
        table.localOrderLineId,
      )
      .where(sql`${table.localOrderLineId} is not null`),
    index("woocommerce_order_line_syncs_issue_idx").on(
      table.organizationId,
      table.connectionId,
      table.status,
    ).where(sql`${table.status} <> 'synced'`),
    check(
      "woocommerce_order_line_syncs_status_check",
      sql`${table.status} in ('synced', 'unmapped', 'error')`,
    ),
    check(
      "woocommerce_order_line_syncs_quantities_check",
      sql`${table.orderedQuantity} >= 0 and ${table.refundedQuantity} >= 0 and ${table.appliedQuantity} >= 0 and ${table.revision} >= 0`,
    ),
    check(
      "woocommerce_order_line_syncs_mapping_check",
      sql`(${table.resourceId} is null and ${table.variantId} is null) or ${table.resourceId} is not null`,
    ),
  ],
);

export const wooCommerceWebhookDeliveries = pgTable(
  "woocommerce_webhook_deliveries",
  {
    organizationId: organizationIdColumn(),
    connectionId: uuid("connection_id").notNull(),
    deliveryId: varchar("delivery_id", { length: 160 }).notNull(),
    webhookId: bigint("webhook_id", { mode: "number" }),
    topic: varchar("topic", { length: 80 }).notNull(),
    payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
    orderId: bigint("order_id", { mode: "number" }),
    status: varchar("status", { length: 16 })
      .$type<"processing" | "succeeded" | "failed">()
      .notNull()
      .default("processing"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: "woocommerce_webhook_deliveries_pk",
      columns: [table.organizationId, table.connectionId, table.deliveryId],
    }),
    foreignKey({
      name: "woocommerce_webhook_deliveries_connection_fk",
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [
        wooCommerceConnections.organizationId,
        wooCommerceConnections.id,
      ],
    }).onDelete("cascade"),
    index("woocommerce_webhook_deliveries_received_idx").on(
      table.organizationId,
      table.connectionId,
      table.receivedAt,
    ),
    check(
      "woocommerce_webhook_deliveries_status_check",
      sql`${table.status} in ('processing', 'succeeded', 'failed')`,
    ),
    check(
      "woocommerce_webhook_deliveries_payload_hash_check",
      sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    prefix: varchar("prefix", { length: 24 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    scopes: text("scopes").array().notNull().default(["read"]),
    createdBy: varchar("created_by", { length: 320 }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    userSessionVersion: integer("user_session_version"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("api_tokens_hash_unique").on(table.tokenHash),
    index("api_tokens_prefix_idx").on(table.prefix),
    index("api_tokens_user_id_idx").on(table.organizationId, table.userId),
    check(
      "api_tokens_user_binding_check",
      sql`(${table.userId} is null and ${table.userSessionVersion} is null) or (${table.userId} is not null and ${table.userSessionVersion} > 0)`,
    ),
  ],
);

export const mcpRateLimitBuckets = pgTable(
  "mcp_rate_limit_buckets",
  {
    organizationId: organizationIdColumn(),
    bucketKey: varchar("bucket_key", { length: 64 }).notNull(),
    principalHash: varchar("principal_hash", { length: 64 }).notNull(),
    operation: varchar("operation", { length: 16 })
      .$type<"request" | "read" | "write">()
      .notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "mcp_rate_limit_buckets_pk",
      columns: [table.organizationId, table.bucketKey],
    }),
    index("mcp_rate_limit_buckets_expiry_idx").on(table.expiresAt),
    check(
      "mcp_rate_limit_buckets_operation_check",
      sql`${table.operation} in ('request', 'read', 'write')`,
    ),
    check(
      "mcp_rate_limit_buckets_count_positive",
      sql`${table.requestCount} > 0`,
    ),
  ],
);

export const mcpAuditEvents = pgTable(
  "mcp_audit_events",
  {
    organizationId: organizationIdColumn(),
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull(),
    tokenId: uuid("token_id").references(() => apiTokens.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    principalHash: varchar("principal_hash", { length: 64 }).notNull(),
    toolName: varchar("tool_name", { length: 80 }).notNull(),
    operation: varchar("operation", { length: 16 })
      .$type<"read" | "write">()
      .notNull(),
    status: varchar("status", { length: 24 })
      .$type<"success" | "error" | "rate_limited">()
      .notNull(),
    argumentsHash: varchar("arguments_hash", { length: 64 }).notNull(),
    targetIds: uuid("target_ids").array().notNull().default([]),
    durationMs: integer("duration_ms").notNull(),
    errorCode: varchar("error_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mcp_audit_events_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("mcp_audit_events_token_created_idx").on(
      table.tokenId,
      table.createdAt,
    ),
    check(
      "mcp_audit_events_operation_check",
      sql`${table.operation} in ('read', 'write')`,
    ),
    check(
      "mcp_audit_events_status_check",
      sql`${table.status} in ('success', 'error', 'rate_limited')`,
    ),
    check("mcp_audit_events_duration_nonnegative", sql`${table.durationMs} >= 0`),
  ],
);

export type ResourceRecord = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type ContactRecord = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type ContactResourceRecord = typeof contactResources.$inferSelect;
export type ContactCommentRecord = typeof contactComments.$inferSelect;
export type ResourceSlugRecord = typeof resourceSlugs.$inferSelect;
export type ResourceFavoriteRecord = typeof resourceFavorites.$inferSelect;
export type ResourceCommentRecord = typeof resourceComments.$inferSelect;
export type NewResourceComment = typeof resourceComments.$inferInsert;
export type ResourceVariantRecord = typeof resourceVariants.$inferSelect;
export type NewResourceVariant = typeof resourceVariants.$inferInsert;
export type TranslationLanguageRecord =
  typeof translationLanguages.$inferSelect;
export type ResourceTranslationRecord = typeof resourceTranslations.$inferSelect;
export type ResourceTranslationJobRecord =
  typeof resourceTranslationJobs.$inferSelect;
export type CustomFieldDefinitionRecord =
  typeof customFieldDefinitions.$inferSelect;
export type LabelSetupRecord = typeof labelSetups.$inferSelect;
export type MediaRecord = typeof media.$inferSelect;
export type ApiTokenRecord = typeof apiTokens.$inferSelect;
export type McpAuditEventRecord = typeof mcpAuditEvents.$inferSelect;
export type OrganizationRecord = typeof organizations.$inferSelect;
export type OrganizationMembershipRecord =
  typeof organizationMemberships.$inferSelect;
export type PublicShareRecord = typeof publicShares.$inferSelect;
export type NotificationPreferenceRecord =
  typeof notificationPreferences.$inferSelect;
export type NotificationInboxRecord = typeof notificationInbox.$inferSelect;
export type NotificationDispatchRecord =
  typeof notificationDispatches.$inferSelect;
export type NotificationPushSubscriptionRecord =
  typeof notificationPushSubscriptions.$inferSelect;
export type WebhookEndpointRecord = typeof webhookEndpoints.$inferSelect;
export type WebhookEventRecord = typeof webhookEvents.$inferSelect;
export type WebhookDeliveryRecord = typeof webhookDeliveries.$inferSelect;
export type WooCommerceConnectionRecord =
  typeof wooCommerceConnections.$inferSelect;
export type WooCommerceOrderSyncRecord =
  typeof wooCommerceOrderSyncs.$inferSelect;
export type WooCommerceOrderLineSyncRecord =
  typeof wooCommerceOrderLineSyncs.$inferSelect;
export type WooCommerceWebhookDeliveryRecord =
  typeof wooCommerceWebhookDeliveries.$inferSelect;
export type StockSettingsRecord = typeof stockSettings.$inferSelect;
export type ResourceLendingSettingsRecord =
  typeof resourceLendingSettings.$inferSelect;
export type StockMovementRecord = typeof stockMovements.$inferSelect;
export type StockCostLayerRecord = typeof stockCostLayers.$inferSelect;
export type StockCostAllocationRecord = typeof stockCostAllocations.$inferSelect;
export type StockUnitRecord = typeof stockUnits.$inferSelect;
export type InventoryTypeDefinitionRecord =
  typeof inventoryTypeDefinitions.$inferSelect;
export type RelationTypeDefinitionRecord =
  typeof relationTypeDefinitions.$inferSelect;
export type ResourceRelationRecord = typeof resourceRelations.$inferSelect;
export type StockLocationBalanceRecord =
  typeof stockLocationBalances.$inferSelect;
export type InventoryCyclePolicyRecord =
  typeof inventoryCyclePolicies.$inferSelect;
export type InventoryCountRecord = typeof inventoryCounts.$inferSelect;
export type InventoryAssignmentRecord =
  typeof inventoryAssignments.$inferSelect;
export type InternalRequestRecord = typeof internalRequests.$inferSelect;
export type InternalRequestLineRecord = typeof internalRequestLines.$inferSelect;
export type InternalRequestEventRecord = typeof internalRequestEvents.$inferSelect;
export type BomLineRecord = typeof bomLines.$inferSelect;
export type VariantBomOverrideRecord = typeof variantBomOverrides.$inferSelect;
export type ResourceOptionGroupRecord = typeof resourceOptionGroups.$inferSelect;
export type ResourceOptionValueRecord = typeof resourceOptionValues.$inferSelect;
export type ResourceOptionConfigurationRecord =
  typeof resourceOptionConfigurations.$inferSelect;
export type ResourceOptionSelectionRecord =
  typeof resourceOptionSelections.$inferSelect;
export type AssemblyBuildRecord = typeof assemblyBuilds.$inferSelect;
export type AssemblyBuildComponentRecord =
  typeof assemblyBuildComponents.$inferSelect;
export type OrderRecord = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderLineRecord = typeof orderLines.$inferSelect;
export type NewOrderLine = typeof orderLines.$inferInsert;
export type OrderLineUnitRecord = typeof orderLineUnits.$inferSelect;
export type NewOrderLineUnit = typeof orderLineUnits.$inferInsert;
export type PurchaseOrderRecord = OrderRecord;
export type PurchaseOrderLineRecord = OrderLineRecord;
export type PurchaseReceiptRecord = typeof purchaseReceipts.$inferSelect;
export type StockScanWorkflowRecord = typeof stockScanWorkflows.$inferSelect;
export type StockScanExecutionRecord = typeof stockScanExecutions.$inferSelect;
export type UserRecord = typeof users.$inferSelect;
export type AccessRoleRecord = typeof accessRoles.$inferSelect;
export type AiUsageEventRecord = typeof aiUsageEvents.$inferSelect;
export type InventoryAccessRuleRecord =
  typeof inventoryAccessRules.$inferSelect;
export type RoomScanRecord = typeof roomScans.$inferSelect;
export type RoomScanAssetRecord = typeof roomScanAssets.$inferSelect;
export type RoomScanKeyframeRecord = typeof roomScanKeyframes.$inferSelect;
export type ResourceSpatialPlacementRecord =
  typeof resourceSpatialPlacements.$inferSelect;
