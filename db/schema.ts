import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  ScanWorkflowExtraction,
  ScanWorkflowFixedProperty,
  ScanWorkflowInputField,
} from "@/lib/scan-workflow-contract";
import {
  customFieldResourceTypes,
  type CustomFieldEntityType,
  type CustomFieldOption,
  type CustomFieldResourceType,
  type CustomFieldType,
  type CustomFieldValues,
} from "@/lib/custom-field-contract";
import type { RoomScene } from "@/lib/room-scene-contract";

export const userRoles = ["admin", "editor", "viewer"] as const;
export type UserRole = (typeof userRoles)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: varchar("role", { length: 16 })
      .$type<UserRole>()
      .notNull()
      .default("editor"),
    isActive: boolean("is_active").notNull().default(true),
    sessionVersion: integer("session_version").notNull().default(1),
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
    check(
      "users_role_check",
      sql`${table.role} in ('admin', 'editor', 'viewer')`,
    ),
    check("users_session_version_positive", sql`${table.sessionVersion} > 0`),
  ],
);

export const resourceTypes = customFieldResourceTypes;

export type BuiltinResourceType = (typeof resourceTypes)[number];
export type ResourceType = string;

export const relationOrigins = ["manual", "spatial"] as const;
export type RelationOrigin = (typeof relationOrigins)[number];

export const assignmentKinds = ["checkout", "assignment", "reservation"] as const;
export type AssignmentKind = (typeof assignmentKinds)[number];

export const assignmentStatuses = ["active", "returned", "cancelled"] as const;
export type AssignmentStatus = (typeof assignmentStatuses)[number];

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

export const roomScanStatuses = ["active", "superseded"] as const;
export type RoomScanStatus = (typeof roomScanStatuses)[number];

export const roomScanAssetKinds = [
  "world_map",
  "model_usdz",
  "guide_image",
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
    key: varchar("key", { length: 64 }).primaryKey(),
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
    index("inventory_type_definitions_active_position_idx").on(
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
    key: varchar("key", { length: 64 }).primaryKey(),
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
    index("relation_type_definitions_active_position_idx").on(
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

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 240 }).notNull(),
    description: text("description").notNull().default(""),
    type: varchar("type", { length: 64 })
      .$type<ResourceType>()
      .notNull()
      .default("object")
      .references(() => inventoryTypeDefinitions.key, { onDelete: "restrict", onUpdate: "cascade" }),
    status: varchar("status", { length: 32 }).notNull().default("available"),
    sku: varchar("sku", { length: 80 }),
    quantity: integer("quantity").notNull().default(1),
    location: varchar("location", { length: 240 }),
    serialNumber: varchar("serial_number", { length: 180 }),
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
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("resources_sku_unique").on(table.sku),
    index("resources_name_idx").on(table.name),
    index("resources_type_idx").on(table.type),
    index("resources_status_idx").on(table.status),
    index("resources_updated_at_idx").on(table.updatedAt),
    check("resources_quantity_nonnegative", sql`${table.quantity} >= 0`),
    check(
      "resources_custom_fields_object",
      sql`jsonb_typeof(${table.customFields}) = 'object'`,
    ),
  ],
);

export const roomScans = pgTable(
  "room_scans",
  {
    id: uuid("id").primaryKey(),
    roomResourceId: uuid("room_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    status: varchar("status", { length: 16 })
      .$type<RoomScanStatus>()
      .notNull()
      .default("active"),
    scene: jsonb("scene").$type<RoomScene>().notNull(),
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
    uniqueIndex("room_scans_room_revision_unique").on(
      table.roomResourceId,
      table.revision,
    ),
    uniqueIndex("room_scans_one_active_per_room")
      .on(table.roomResourceId)
      .where(sql`${table.status} = 'active'`),
    index("room_scans_room_status_idx").on(table.roomResourceId, table.status),
    index("room_scans_captured_at_idx").on(table.capturedAt),
    check("room_scans_revision_positive", sql`${table.revision} > 0`),
    check(
      "room_scans_status_check",
      sql`${table.status} in ('active', 'superseded')`,
    ),
    check("room_scans_scene_object", sql`jsonb_typeof(${table.scene}) = 'object'`),
  ],
);

export const roomScanAssets = pgTable(
  "room_scan_assets",
  {
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
    uniqueIndex("room_scan_assets_scan_kind_unique").on(
      table.roomScanId,
      table.kind,
    ),
    index("room_scan_assets_scan_idx").on(table.roomScanId),
    check(
      "room_scan_assets_kind_check",
      sql`${table.kind} in ('world_map', 'model_usdz', 'guide_image')`,
    ),
    check("room_scan_assets_size_nonnegative", sql`${table.size} >= 0`),
  ],
);

export const resourceSpatialPlacements = pgTable(
  "resource_spatial_placements",
  {
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
  ],
);

export const resourceRelations = pgTable(
  "resource_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceResourceId: uuid("source_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    targetResourceId: uuid("target_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    relationTypeKey: varchar("relation_type_key", { length: 64 })
      .notNull()
      .references(() => relationTypeDefinitions.key, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    origin: varchar("origin", { length: 16 })
      .$type<RelationOrigin>()
      .notNull()
      .default("manual"),
    sourceFeatureId: varchar("source_feature_id", { length: 80 }),
    targetFeatureId: varchar("target_feature_id", { length: 80 }),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("resource_relations_edge_unique").on(
      table.sourceResourceId,
      table.targetResourceId,
      table.relationTypeKey,
    ),
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
  ],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
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
      sql`${table.fieldType} in ('text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'select', 'multi_select', 'email', 'url')`,
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

export const resourceCreationRequests = pgTable(
  "resource_creation_requests",
  {
    idempotencyKey: uuid("idempotency_key").primaryKey(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resourceId: uuid("resource_id").notNull().unique(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("resource_creation_requests_resource_id_idx").on(table.resourceId)],
);

export const bomLines = pgTable(
  "bom_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assemblyResourceId: uuid("assembly_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    componentResourceId: uuid("component_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    quantityPerAssembly: integer("quantity_per_assembly").notNull(),
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
    uniqueIndex("bom_lines_assembly_component_unique").on(
      table.assemblyResourceId,
      table.componentResourceId,
    ),
    index("bom_lines_assembly_resource_id_idx").on(table.assemblyResourceId),
    index("bom_lines_component_resource_id_idx").on(table.componentResourceId),
    check(
      "bom_lines_quantity_per_assembly_positive",
      sql`${table.quantityPerAssembly} > 0`,
    ),
    check("bom_lines_position_nonnegative", sql`${table.position} >= 0`),
    check(
      "bom_lines_distinct_resources",
      sql`${table.assemblyResourceId} <> ${table.componentResourceId}`,
    ),
  ],
);

export const assemblyBuilds = pgTable(
  "assembly_builds",
  {
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
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reference: varchar("reference", { length: 160 }),
    supplier: varchar("supplier", { length: 240 }).notNull(),
    status: varchar("status", { length: 32 })
      .$type<PurchaseOrderStatus>()
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
    uniqueIndex("purchase_orders_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("purchase_orders_status_idx").on(table.status),
    index("purchase_orders_expected_at_idx").on(table.expectedAt),
    check(
      "purchase_orders_status_check",
      sql`${table.status} in ('draft', 'ordered', 'partially-received', 'received', 'cancelled')`,
    ),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    orderedQuantity: integer("ordered_quantity").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
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
    uniqueIndex("purchase_order_lines_order_resource_unique").on(
      table.purchaseOrderId,
      table.resourceId,
    ),
    index("purchase_order_lines_purchase_order_id_idx").on(
      table.purchaseOrderId,
    ),
    index("purchase_order_lines_resource_id_idx").on(table.resourceId),
    check(
      "purchase_order_lines_ordered_quantity_positive",
      sql`${table.orderedQuantity} > 0`,
    ),
    check(
      "purchase_order_lines_received_quantity_nonnegative",
      sql`${table.receivedQuantity} >= 0`,
    ),
    check(
      "purchase_order_lines_received_not_above_ordered",
      sql`${table.receivedQuantity} <= ${table.orderedQuantity}`,
    ),
  ],
);

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseOrderLineId: uuid("purchase_order_line_id")
      .notNull()
      .references(() => purchaseOrderLines.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
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
      table.idempotencyKey,
    ),
    index("purchase_receipts_purchase_order_line_id_idx").on(
      table.purchaseOrderLineId,
    ),
    index("purchase_receipts_line_occurred_idx").on(
      table.purchaseOrderLineId,
      table.occurredAt,
    ),
    check("purchase_receipts_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

export const stockSettings = pgTable(
  "stock_settings",
  {
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
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
  ],
);

export const stockLocationBalances = pgTable(
  "stock_location_balances",
  {
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
    uniqueIndex("stock_location_balances_resource_location_unique").on(
      table.resourceId,
      table.locationResourceId,
    ),
    index("stock_location_balances_location_idx").on(table.locationResourceId),
    check(
      "stock_location_balances_nonnegative",
      sql`${table.quantity} >= 0`,
    ),
    check(
      "stock_location_balances_distinct_resources",
      sql`${table.resourceId} <> ${table.locationResourceId}`,
    ),
  ],
);

export const inventoryCyclePolicies = pgTable(
  "inventory_cycle_policies",
  {
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
    uniqueIndex("stock_units_resource_code_unique").on(
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
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
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
    delta: integer("delta").notNull(),
    quantity: integer("quantity").notNull().default(0),
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
    index("stock_movements_resource_id_idx").on(table.resourceId),
    index("stock_movements_resource_occurred_idx").on(
      table.resourceId,
      table.occurredAt,
    ),
    index("stock_movements_unit_id_idx").on(table.unitId),
    index("stock_movements_assembly_build_id_idx").on(table.assemblyBuildId),
    index("stock_movements_purchase_receipt_id_idx").on(
      table.purchaseReceiptId,
    ),
    index("stock_movements_from_location_idx").on(table.fromLocationResourceId),
    index("stock_movements_to_location_idx").on(table.toLocationResourceId),
    check(
      "stock_movements_balance_nonnegative",
      sql`${table.balanceAfter} >= 0`,
    ),
    check(
      "stock_movements_quantity_nonnegative",
      sql`${table.quantity} >= 0`,
    ),
    check(
      "stock_movements_from_location_balance_nonnegative",
      sql`${table.fromLocationBalanceAfter} is null or ${table.fromLocationBalanceAfter} >= 0`,
    ),
    check(
      "stock_movements_to_location_balance_nonnegative",
      sql`${table.toLocationBalanceAfter} is null or ${table.toLocationBalanceAfter} >= 0`,
    ),
  ],
);

export const inventoryCounts = pgTable(
  "inventory_counts",
  {
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
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    stockUnitId: uuid("stock_unit_id").references(() => stockUnits.id, {
      onDelete: "restrict",
    }),
    kind: varchar("kind", { length: 24 })
      .$type<AssignmentKind>()
      .notNull(),
    status: varchar("status", { length: 24 })
      .$type<AssignmentStatus>()
      .notNull()
      .default("active"),
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
    index("inventory_assignments_resource_status_idx").on(
      table.resourceId,
      table.status,
    ),
    index("inventory_assignments_due_idx").on(table.status, table.dueAt),
    index("inventory_assignments_stock_unit_idx").on(table.stockUnitId),
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
  ],
);

export const stockMovementRequests = pgTable(
  "stock_movement_requests",
  {
    idempotencyKey: uuid("idempotency_key").primaryKey(),
    resourceId: uuid("resource_id").notNull(),
    actor: varchar("actor", { length: 320 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("stock_movement_requests_resource_id_idx").on(table.resourceId)],
);

export const stockScanWorkflows = pgTable(
  "stock_scan_workflows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    extraction: jsonb("extraction")
      .$type<ScanWorkflowExtraction>()
      .notNull(),
    identifierPropertyKey: varchar("identifier_property_key", {
      length: 80,
    }).notNull(),
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
    check("stock_scan_workflows_revision_positive", sql`${table.revision} > 0`),
    check(
      "stock_scan_workflows_unit_status_check",
      sql`${table.unitStatus} is null or ${table.unitStatus} in ('available', 'reserved', 'in-use', 'maintenance', 'consumed', 'lost', 'retired')`,
    ),
    check(
      "stock_scan_workflows_extraction_object",
      sql`jsonb_typeof(${table.extraction}) = 'object'`,
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
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    url: text("url").notNull(),
    name: varchar("name", { length: 280 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull().default("image"),
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
    index("media_resource_id_idx").on(table.resourceId),
    index("media_resource_position_idx").on(table.resourceId, table.position),
  ],
);

export const mediaUploadBatches = pgTable(
  "media_upload_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("media_upload_batches_resource_id_idx").on(table.resourceId)],
);

export const mediaUploadBatchItems = pgTable(
  "media_upload_batch_items",
  {
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
    id: uuid("id").defaultRandom().primaryKey(),
    operation: varchar("operation", { length: 24 })
      .$type<"analyze" | "cover">()
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
      table.operation,
      table.idempotencyKey,
    ),
    index("ai_idempotency_operations_resource_id_idx").on(table.resourceId),
    check(
      "ai_idempotency_operations_operation_check",
      sql`${table.operation} in ('analyze', 'cover')`,
    ),
    check(
      "ai_idempotency_operations_status_check",
      sql`${table.status} in ('processing', 'completed', 'failed')`,
    ),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
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
    index("api_tokens_user_id_idx").on(table.userId),
    check(
      "api_tokens_user_binding_check",
      sql`(${table.userId} is null and ${table.userSessionVersion} is null) or (${table.userId} is not null and ${table.userSessionVersion} > 0)`,
    ),
  ],
);

export type ResourceRecord = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type CustomFieldDefinitionRecord =
  typeof customFieldDefinitions.$inferSelect;
export type MediaRecord = typeof media.$inferSelect;
export type ApiTokenRecord = typeof apiTokens.$inferSelect;
export type StockSettingsRecord = typeof stockSettings.$inferSelect;
export type StockMovementRecord = typeof stockMovements.$inferSelect;
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
export type BomLineRecord = typeof bomLines.$inferSelect;
export type AssemblyBuildRecord = typeof assemblyBuilds.$inferSelect;
export type AssemblyBuildComponentRecord =
  typeof assemblyBuildComponents.$inferSelect;
export type PurchaseOrderRecord = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderLineRecord = typeof purchaseOrderLines.$inferSelect;
export type PurchaseReceiptRecord = typeof purchaseReceipts.$inferSelect;
export type StockScanWorkflowRecord = typeof stockScanWorkflows.$inferSelect;
export type StockScanExecutionRecord = typeof stockScanExecutions.$inferSelect;
export type UserRecord = typeof users.$inferSelect;
export type RoomScanRecord = typeof roomScans.$inferSelect;
export type RoomScanAssetRecord = typeof roomScanAssets.$inferSelect;
export type ResourceSpatialPlacementRecord =
  typeof resourceSpatialPlacements.$inferSelect;
