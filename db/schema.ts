import { sql } from "drizzle-orm";
import {
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
  ScanWorkflowFixedProperty,
  ScanWorkflowInputField,
} from "@/lib/scan-workflow-contract";
import type { PaidAiOperation } from "@/lib/ai-rate-limit-policy";
import {
  customFieldResourceTypes,
  type CustomFieldEntityType,
  type CustomFieldOption,
  type CustomFieldResourceType,
  type CustomFieldType,
  type CustomFieldValues,
} from "@/lib/custom-field-contract";
import type { LabelElement } from "@/lib/label-setup-contract";
import type { RoomScene } from "@/lib/room-scene-contract";
import type { SpatialGeoreference } from "@/lib/spatial-structure-contract";
import type {
  AccessRuleCondition,
  AppPermission,
  ResourceRulePermission,
} from "@/lib/access-control-contract";
import type {
  PublicShareFilter,
  PublicShareScope,
} from "@/lib/public-share-contract";

export const userRoles = ["admin", "editor", "viewer"] as const;
export type BuiltinUserRole = (typeof userRoles)[number];
export type UserRole = string;

export const accessRoles = pgTable(
  "access_roles",
  {
    key: varchar("key", { length: 64 }).primaryKey(),
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
      .default("editor")
      .references(() => accessRoles.key, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
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
    check("users_session_version_positive", sql`${table.sessionVersion} > 0`),
  ],
);

export const inventoryAccessRules = pgTable(
  "inventory_access_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    roleKey: varchar("role_key", { length: 64 })
      .notNull()
      .references(() => accessRoles.key, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
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
    index("inventory_access_rules_role_enabled_idx").on(
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
  "structure_model",
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

export const translationLanguages = pgTable(
  "translation_languages",
  {
    code: varchar("code", { length: 35 }).primaryKey(),
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
    uniqueIndex("translation_languages_one_active_default")
      .on(table.isDefault)
      .where(sql`${table.archivedAt} is null and ${table.isDefault} = true`),
    index("translation_languages_active_position_idx").on(
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
    uniqueIndex("resources_sku_unique").on(table.sku),
    index("resources_name_idx").on(table.name),
    index("resources_type_idx").on(table.type),
    index("resources_status_idx").on(table.status),
    index("resources_updated_at_idx").on(table.updatedAt),
    check("resources_quantity_nonnegative", sql`${table.quantity} >= 0`),
    check("resources_content_revision_positive", sql`${table.contentRevision} > 0`),
    check(
      "resources_custom_fields_object",
      sql`jsonb_typeof(${table.customFields}) = 'object'`,
    ),
  ],
);

export const resourceTranslations = pgTable(
  "resource_translations",
  {
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    languageCode: varchar("language_code", { length: 35 })
      .notNull()
      .references(() => translationLanguages.code, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
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
    primaryKey({
      name: "resource_translations_pk",
      columns: [table.resourceId, table.languageCode],
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
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    languageCode: varchar("language_code", { length: 35 })
      .notNull()
      .references(() => translationLanguages.code, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
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
    primaryKey({
      name: "resource_translation_jobs_pk",
      columns: [table.resourceId, table.languageCode],
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
      "room_scans_coordinate_space_requires_structure",
      sql`${table.coordinateSpaceId} is null or ${table.structureId} is not null`,
    ),
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
      sql`${table.kind} in ('world_map', 'model_usdz', 'structure_model', 'guide_image')`,
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
    uniqueIndex("label_setups_name_unique").on(sql`lower(${table.name})`),
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

export const publicShares = pgTable(
  "public_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    scope: varchar("scope", { length: 16 }).$type<PublicShareScope>().notNull(),
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
      .$type<"analyze" | "count" | "cover" | "translate">()
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
      sql`${table.operation} in ('analyze', 'count', 'cover', 'translate')`,
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
      columns: [table.operation, table.subjectHash],
    }),
    check(
      "ai_rate_limit_buckets_operation_check",
      sql`${table.operation} in ('analyze', 'count', 'cover', 'translate')`,
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
export type PublicShareRecord = typeof publicShares.$inferSelect;
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
export type AccessRoleRecord = typeof accessRoles.$inferSelect;
export type InventoryAccessRuleRecord =
  typeof inventoryAccessRules.$inferSelect;
export type RoomScanRecord = typeof roomScans.$inferSelect;
export type RoomScanAssetRecord = typeof roomScanAssets.$inferSelect;
export type ResourceSpatialPlacementRecord =
  typeof resourceSpatialPlacements.$inferSelect;
