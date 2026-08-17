import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import {
  DEMO_ACTOR,
  DEMO_ASSIGNMENTS,
  DEMO_INVENTORY_TYPES,
  DEMO_LABEL_SETUP,
  DEMO_LOCATION_BALANCES,
  DEMO_MEDIA,
  DEMO_ORGANIZATION,
  DEMO_PURCHASE_ORDER_LINES,
  DEMO_PURCHASE_ORDERS,
  DEMO_RELATIONS,
  DEMO_RELATION_TYPES,
  DEMO_RESOURCES,
  DEMO_ROLES,
  DEMO_SEED_VERSION,
  DEMO_STOCK_MOVEMENTS,
  DEMO_STOCK_SETTINGS,
  DEMO_STOCK_UNITS,
  DEMO_USER,
  validateDemoRemovalState,
  validateDemoSeedManifest,
} from "./demo-seed-manifest.mjs";

const DEMO_LOCK_ID = 4_447_366_842;
const DEMO_PASSWORD_HASH =
  "$2b$12$E8659p48/ALGwQEkVSkRzuwVuq4DhBHDnfAsCy749/PbReQVtfxJG";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const bundledAssetsDirectory = path.resolve(scriptDirectory, "../demo/assets");
const mediaStoragePrefix = "demo";

const value = (name) => process.env[name]?.trim() ?? "";
const removeRequested = process.argv.slice(2).includes("--remove");
const unexpectedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--remove");

if (unexpectedArguments.length > 0) {
  throw new Error(`Unknown demo seed argument: ${unexpectedArguments.join(", ")}`);
}

for (const envFile of [".env.local", ".env"]) {
  if (process.env.DATABASE_URL || !existsSync(envFile)) continue;
  process.loadEnvFile(envFile);
}

const enabled = value("DEMO_ACCESS_ENABLED").toLocaleLowerCase("en-US") === "true";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://inventory:inventory@localhost:5432/inventory";

function demoConfiguration() {
  const slug = (value("DEMO_ORGANIZATION_SLUG") || DEMO_ORGANIZATION.slug)
    .toLocaleLowerCase("en-US");
  const email = (value("DEMO_USER_EMAIL") || DEMO_USER.email)
    .toLocaleLowerCase("en-US");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    throw new Error("DEMO_ORGANIZATION_SLUG must be a valid organization slug.");
  }
  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("DEMO_USER_EMAIL must be a valid lowercase email address.");
  }
  return { slug, email };
}

const sha256 = (buffer) =>
  createHash("sha256").update(buffer).digest("hex");

function localStorageRoot() {
  return path.resolve(
    value("STORAGE_LOCAL_PATH") || path.join(process.cwd(), "data/uploads"),
  );
}

function localMediaPath(filename) {
  return path.join(localStorageRoot(), mediaStoragePrefix, filename);
}

async function prepareLocalMedia() {
  const storageProvider = value("STORAGE_PROVIDER").toLocaleLowerCase("en-US") || "local";
  if (storageProvider !== "local") {
    process.stdout.write(
      `Demo media skipped for STORAGE_PROVIDER=${storageProvider}; seeded records remain fully usable without photos.\n`,
    );
    return [];
  }

  const targetDirectory = path.join(localStorageRoot(), mediaStoragePrefix);
  await mkdir(targetDirectory, { recursive: true });
  const prepared = [];
  for (const asset of DEMO_MEDIA) {
    const source = path.join(bundledAssetsDirectory, asset.filename);
    const sourceBuffer = await readFile(source);
    const sourceHash = sha256(sourceBuffer);
    if (sourceHash !== asset.sha256) {
      throw new Error(
        `Demo asset checksum mismatch for ${asset.filename}: expected ${asset.sha256}, received ${sourceHash}.`,
      );
    }
    const target = localMediaPath(asset.filename);
    let targetMatches = false;
    try {
      targetMatches = sha256(await readFile(target)) === asset.sha256;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    if (!targetMatches) await copyFile(source, target);
    const details = await stat(target);
    prepared.push({ ...asset, size: details.size });
  }
  return prepared;
}

async function removeLocalMedia() {
  const storageProvider = value("STORAGE_PROVIDER").toLocaleLowerCase("en-US") || "local";
  if (storageProvider !== "local") return;
  for (const asset of DEMO_MEDIA) {
    try {
      await unlink(localMediaPath(asset.filename));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
}

const atDaysAgo = (reference, days) =>
  new Date(reference.getTime() - days * 24 * 60 * 60 * 1_000);
const atDaysFromNow = (reference, days) =>
  new Date(reference.getTime() + days * 24 * 60 * 60 * 1_000);

async function assertSchemaIsReady(transaction) {
  const [column] = await transaction`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'organizations'
      AND column_name = 'is_read_only'
    LIMIT 1
  `;
  if (!column) {
    throw new Error(
      "The read-only organization migration is missing. Apply database migrations before seeding the demo.",
    );
  }
}

async function assertIdentitySlotsAreSafe(transaction, configuration) {
  const organizations = await transaction`
    SELECT id, name, slug, is_read_only
    FROM organizations
    WHERE id = ${DEMO_ORGANIZATION.id} OR slug = ${configuration.slug}
    FOR UPDATE
  `;
  for (const organization of organizations) {
    if (organization.id !== DEMO_ORGANIZATION.id) {
      throw new Error(
        `Demo slug ${configuration.slug} is already owned by another organization; refusing to seed.`,
      );
    }
    if (organization.slug !== configuration.slug) {
      throw new Error(
        `The fixed demo organization ID already uses slug ${organization.slug}; refusing to rename it implicitly.`,
      );
    }
  }

  const users = await transaction`
    SELECT id, email
    FROM users
    WHERE id = ${DEMO_USER.id} OR email = ${configuration.email}
    FOR UPDATE
  `;
  for (const user of users) {
    if (user.id !== DEMO_USER.id) {
      throw new Error(
        `Demo email ${configuration.email} is already owned by another user; refusing to seed.`,
      );
    }
    if (user.email !== configuration.email) {
      throw new Error(
        `The fixed demo user ID already uses ${user.email}; refusing to rename it implicitly.`,
      );
    }
  }
}

async function assertTenantRowIdsAreSafe(transaction) {
  const collisions = await transaction`
    SELECT table_name, id
    FROM (
      SELECT 'resources' AS table_name, id, organization_id FROM resources
      WHERE id = ANY(${DEMO_RESOURCES.map(({ id }) => id)})
      UNION ALL
      SELECT 'stock_location_balances', id, organization_id FROM stock_location_balances
      WHERE id = ANY(${DEMO_LOCATION_BALANCES.map(({ id }) => id)})
      UNION ALL
      SELECT 'stock_units', id, organization_id FROM stock_units
      WHERE id = ANY(${DEMO_STOCK_UNITS.map(({ id }) => id)})
      UNION ALL
      SELECT 'stock_movements', id, organization_id FROM stock_movements
      WHERE id = ANY(${DEMO_STOCK_MOVEMENTS.map(({ id }) => id)})
      UNION ALL
      SELECT 'inventory_assignments', id, organization_id FROM inventory_assignments
      WHERE id = ANY(${DEMO_ASSIGNMENTS.map(({ id }) => id)})
      UNION ALL
      SELECT 'purchase_orders', id, organization_id FROM purchase_orders
      WHERE id = ANY(${DEMO_PURCHASE_ORDERS.map(({ id }) => id)})
      UNION ALL
      SELECT 'purchase_order_lines', id, organization_id FROM purchase_order_lines
      WHERE id = ANY(${DEMO_PURCHASE_ORDER_LINES.map(({ id }) => id)})
      UNION ALL
      SELECT 'resource_relations', id, organization_id FROM resource_relations
      WHERE id = ANY(${DEMO_RELATIONS.map(({ id }) => id)})
      UNION ALL
      SELECT 'label_setups', id, organization_id FROM label_setups
      WHERE id = ${DEMO_LABEL_SETUP.id}
      UNION ALL
      SELECT 'media', id, organization_id FROM media
      WHERE id = ANY(${DEMO_MEDIA.map(({ id }) => id)})
    ) seeded_rows
    WHERE organization_id <> ${DEMO_ORGANIZATION.id}
  `;
  if (collisions.length > 0) {
    const collision = collisions[0];
    throw new Error(
      `Fixed demo ID ${collision.id} already belongs to another organization in ${collision.table_name}; refusing to seed.`,
    );
  }
}

async function seedDemo(transaction, configuration, preparedMedia) {
  const referenceTime = new Date();
  await transaction`
    INSERT INTO organizations (
      id, name, slug, is_read_only, created_by, updated_at
    ) VALUES (
      ${DEMO_ORGANIZATION.id}, ${DEMO_ORGANIZATION.name}, ${configuration.slug},
      false, ${DEMO_ACTOR}, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      updated_at = now()
  `;

  for (const role of DEMO_ROLES) {
    await transaction`
      INSERT INTO access_roles (
        organization_id, key, name, description, permissions, is_system,
        created_by, updated_by, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${role.key}, ${role.name}, ${role.description},
        ${role.permissions}, true, ${DEMO_ACTOR}, ${DEMO_ACTOR}, now()
      )
      ON CONFLICT (organization_id, key) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        permissions = excluded.permissions,
        is_system = true,
        updated_by = excluded.updated_by,
        updated_at = now()
    `;
  }

  for (const type of DEMO_INVENTORY_TYPES) {
    await transaction`
      INSERT INTO inventory_type_definitions (
        organization_id, key, label, description, color, icon, can_contain,
        spatial_containment, position, is_system, created_by, updated_by, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${type.key}, ${type.label}, ${type.description},
        ${type.color}, ${type.icon}, ${type.canContain}, ${type.spatialContainment},
        ${type.position}, true, ${DEMO_ACTOR}, ${DEMO_ACTOR}, now()
      )
      ON CONFLICT (organization_id, key) DO UPDATE SET
        label = excluded.label,
        description = excluded.description,
        color = excluded.color,
        icon = excluded.icon,
        can_contain = excluded.can_contain,
        spatial_containment = excluded.spatial_containment,
        position = excluded.position,
        is_system = true,
        archived_at = null,
        updated_by = excluded.updated_by,
        updated_at = now()
    `;
  }

  for (const relationType of DEMO_RELATION_TYPES) {
    await transaction`
      INSERT INTO relation_type_definitions (
        organization_id, key, label, inverse_label, description, allow_manual,
        spatial, position, is_system, created_by, updated_by, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${relationType.key}, ${relationType.label},
        ${relationType.inverseLabel}, ${relationType.description},
        ${relationType.allowManual}, ${relationType.spatial}, ${relationType.position},
        true, ${DEMO_ACTOR}, ${DEMO_ACTOR}, now()
      )
      ON CONFLICT (organization_id, key) DO UPDATE SET
        label = excluded.label,
        inverse_label = excluded.inverse_label,
        description = excluded.description,
        allow_manual = excluded.allow_manual,
        spatial = excluded.spatial,
        position = excluded.position,
        is_system = true,
        archived_at = null,
        updated_by = excluded.updated_by,
        updated_at = now()
    `;
  }

  await transaction`
    INSERT INTO translation_languages (
      organization_id, code, label, is_default, auto_translate, instructions,
      position, created_by, updated_by, updated_at
    ) VALUES (
      ${DEMO_ORGANIZATION.id}, 'de', 'Deutsch', true, false, '', 0,
      ${DEMO_ACTOR}, ${DEMO_ACTOR}, now()
    )
    ON CONFLICT (organization_id, code) DO UPDATE SET
      label = excluded.label,
      is_default = true,
      auto_translate = false,
      archived_at = null,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  await transaction`
    INSERT INTO users (
      id, email, name, password_hash, role, is_active, created_by, updated_by,
      password_updated_at, updated_at
    ) VALUES (
      ${DEMO_USER.id}, ${configuration.email}, ${DEMO_USER.name},
      ${DEMO_PASSWORD_HASH}, 'viewer', true, ${DEMO_ACTOR}, ${DEMO_ACTOR},
      now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      password_hash = excluded.password_hash,
      role = 'viewer',
      is_active = true,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  await transaction`
    DELETE FROM organization_memberships
    WHERE user_id = ${DEMO_USER.id}
      AND organization_id <> ${DEMO_ORGANIZATION.id}
  `;
  await transaction`
    DELETE FROM organization_memberships
    WHERE organization_id = ${DEMO_ORGANIZATION.id}
      AND user_id <> ${DEMO_USER.id}
  `;
  await transaction`
    INSERT INTO organization_memberships (
      organization_id, user_id, role_key, is_active, created_by, updated_at
    ) VALUES (
      ${DEMO_ORGANIZATION.id}, ${DEMO_USER.id}, 'viewer', true,
      ${DEMO_ACTOR}, now()
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role_key = 'viewer',
      is_active = true,
      updated_at = now()
  `;

  for (const resource of DEMO_RESOURCES) {
    const updatedAt = atDaysAgo(referenceTime, resource.updatedDaysAgo);
    await transaction`
      INSERT INTO resources (
        organization_id, id, name, description, type, status, sku, quantity,
        location, barcode, value_cents, currency, priority, tags, categories,
        custom_fields, notes, created_by, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${resource.id}, ${resource.name},
        ${resource.description}, ${resource.type}, ${resource.status},
        ${resource.sku}, ${resource.quantity}, ${resource.location},
        ${resource.barcode}, ${resource.valueCents}, 'EUR', ${resource.priority},
        ${resource.tags}, ${transaction.json(resource.categories)},
        ${transaction.json(resource.customFields)}, ${resource.notes},
        ${DEMO_ACTOR}, ${updatedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        type = excluded.type,
        status = excluded.status,
        sku = excluded.sku,
        quantity = excluded.quantity,
        location = excluded.location,
        serial_number = null,
        barcode = excluded.barcode,
        value_cents = excluded.value_cents,
        currency = excluded.currency,
        priority = excluded.priority,
        tags = excluded.tags,
        categories = excluded.categories,
        custom_fields = excluded.custom_fields,
        related_resource_ids = '{}',
        notes = excluded.notes,
        ai_metadata = null,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at
    `;
  }

  // Resource inserts invoke the application's stock bootstrap trigger. The
  // curated demo carries its own deterministic ledger, so remove only the
  // trigger rows attributable to this fixed tenant and actor before upserting
  // that ledger. This also reconciles fresh and repeated seed runs identically.
  await transaction`
    DELETE FROM stock_movements
    WHERE organization_id = ${DEMO_ORGANIZATION.id}
      AND type = 'opening_balance'
      AND created_by = ${DEMO_ACTOR}
  `;

  for (const settings of DEMO_STOCK_SETTINGS) {
    await transaction`
      INSERT INTO stock_settings (
        organization_id, resource_id, tracking_mode, minimum_stock,
        reorder_quantity, lead_time_days, unit_name, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${settings.resourceId}, ${settings.trackingMode},
        ${settings.minimumStock}, ${settings.reorderQuantity},
        ${settings.leadTimeDays}, ${settings.unitName}, now()
      )
      ON CONFLICT (resource_id) DO UPDATE SET
        tracking_mode = excluded.tracking_mode,
        minimum_stock = excluded.minimum_stock,
        reorder_quantity = excluded.reorder_quantity,
        lead_time_days = excluded.lead_time_days,
        unit_name = excluded.unit_name,
        updated_at = now()
    `;
  }

  for (const balance of DEMO_LOCATION_BALANCES) {
    await transaction`
      INSERT INTO stock_location_balances (
        organization_id, id, resource_id, location_resource_id, quantity, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${balance.id}, ${balance.resourceId},
        ${balance.locationResourceId}, ${balance.quantity}, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        resource_id = excluded.resource_id,
        location_resource_id = excluded.location_resource_id,
        quantity = excluded.quantity,
        updated_at = now()
    `;
  }

  for (const unit of DEMO_STOCK_UNITS) {
    const acquiredAt = atDaysAgo(referenceTime, 60);
    const lastMovedAt = atDaysAgo(
      referenceTime,
      unit.status === "available" ? 36 : unit.status === "in-use" ? 2 : 1,
    );
    await transaction`
      INSERT INTO stock_units (
        organization_id, id, resource_id, code, status, location,
        location_resource_id, metadata, custom_fields, acquired_at,
        last_moved_at, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${unit.id}, ${unit.resourceId}, ${unit.code},
        ${unit.status}, ${unit.location}, ${unit.locationResourceId},
        ${transaction.json(unit.metadata)}, ${transaction.json({})},
        ${acquiredAt}, ${lastMovedAt}, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        resource_id = excluded.resource_id,
        code = excluded.code,
        status = excluded.status,
        location = excluded.location,
        location_resource_id = excluded.location_resource_id,
        metadata = excluded.metadata,
        custom_fields = excluded.custom_fields,
        last_moved_at = excluded.last_moved_at,
        updated_at = now()
    `;
  }

  for (const movement of DEMO_STOCK_MOVEMENTS) {
    const occurredAt = atDaysAgo(referenceTime, movement.daysAgo);
    await transaction`
      INSERT INTO stock_movements (
        organization_id, id, resource_id, unit_id, delta, quantity,
        balance_after, type, reason, note, location,
        from_location_resource_id, to_location_resource_id, occurred_at,
        created_by
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${movement.id}, ${movement.resourceId},
        ${movement.unitId}, ${movement.delta}, ${movement.quantity},
        ${movement.balanceAfter}, ${movement.type}, ${movement.reason},
        ${movement.note}, ${movement.location}, ${movement.fromLocationResourceId},
        ${movement.toLocationResourceId}, ${occurredAt}, ${DEMO_ACTOR}
      )
      ON CONFLICT (id) DO UPDATE SET
        resource_id = excluded.resource_id,
        unit_id = excluded.unit_id,
        delta = excluded.delta,
        quantity = excluded.quantity,
        balance_after = excluded.balance_after,
        type = excluded.type,
        reason = excluded.reason,
        note = excluded.note,
        location = excluded.location,
        from_location_resource_id = excluded.from_location_resource_id,
        to_location_resource_id = excluded.to_location_resource_id,
        occurred_at = excluded.occurred_at,
        created_by = excluded.created_by
    `;
  }

  for (const assignment of DEMO_ASSIGNMENTS) {
    await transaction`
      INSERT INTO inventory_assignments (
        organization_id, id, resource_id, stock_unit_id, kind, status,
        quantity, assignee_label, starts_at, due_at, note, created_by, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${assignment.id}, ${assignment.resourceId},
        ${assignment.stockUnitId}, ${assignment.kind}, ${assignment.status},
        ${assignment.quantity}, ${assignment.assigneeLabel},
        ${atDaysAgo(referenceTime, assignment.startsDaysAgo)},
        ${atDaysFromNow(referenceTime, assignment.dueDaysFromNow)},
        ${assignment.note}, ${DEMO_ACTOR}, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        resource_id = excluded.resource_id,
        stock_unit_id = excluded.stock_unit_id,
        kind = excluded.kind,
        status = excluded.status,
        quantity = excluded.quantity,
        assignee_user_id = null,
        assignee_resource_id = null,
        assignee_label = excluded.assignee_label,
        starts_at = excluded.starts_at,
        due_at = excluded.due_at,
        completed_at = null,
        note = excluded.note,
        created_by = excluded.created_by,
        completed_by = null,
        updated_at = now()
    `;
  }

  for (const order of DEMO_PURCHASE_ORDERS) {
    await transaction`
      INSERT INTO purchase_orders (
        organization_id, id, reference, supplier, status, ordered_at,
        expected_at, note, response, created_by, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${order.id}, ${order.reference},
        ${order.supplier}, ${order.status},
        ${atDaysAgo(referenceTime, order.orderedDaysAgo)},
        ${atDaysFromNow(referenceTime, order.expectedDaysFromNow)},
        ${order.note}, ${transaction.json({})}, ${DEMO_ACTOR}, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        reference = excluded.reference,
        supplier = excluded.supplier,
        status = excluded.status,
        ordered_at = excluded.ordered_at,
        expected_at = excluded.expected_at,
        note = excluded.note,
        response = excluded.response,
        created_by = excluded.created_by,
        updated_at = now()
    `;
  }

  for (const line of DEMO_PURCHASE_ORDER_LINES) {
    await transaction`
      INSERT INTO purchase_order_lines (
        organization_id, id, purchase_order_id, resource_id, ordered_quantity,
        received_quantity, expected_at, note, updated_at
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${line.id}, ${line.purchaseOrderId},
        ${line.resourceId}, ${line.orderedQuantity}, ${line.receivedQuantity},
        ${atDaysFromNow(referenceTime, line.expectedDaysFromNow)},
        ${line.note}, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        purchase_order_id = excluded.purchase_order_id,
        resource_id = excluded.resource_id,
        ordered_quantity = excluded.ordered_quantity,
        received_quantity = excluded.received_quantity,
        expected_at = excluded.expected_at,
        note = excluded.note,
        updated_at = now()
    `;
  }

  for (const relation of DEMO_RELATIONS) {
    await transaction`
      INSERT INTO resource_relations (
        organization_id, id, source_resource_id, target_resource_id,
        relation_type_key, origin, created_by
      ) VALUES (
        ${DEMO_ORGANIZATION.id}, ${relation.id}, ${relation.sourceResourceId},
        ${relation.targetResourceId}, ${relation.relationTypeKey}, 'manual',
        ${DEMO_ACTOR}
      )
      ON CONFLICT (id) DO UPDATE SET
        source_resource_id = excluded.source_resource_id,
        target_resource_id = excluded.target_resource_id,
        relation_type_key = excluded.relation_type_key,
        origin = excluded.origin,
        source_feature_id = null,
        target_feature_id = null,
        created_by = excluded.created_by
    `;
  }

  await transaction`
    INSERT INTO label_setups (
      organization_id, id, name, width_mm, height_mm, elements, revision,
      created_by, updated_by, updated_at
    ) VALUES (
      ${DEMO_ORGANIZATION.id}, ${DEMO_LABEL_SETUP.id}, ${DEMO_LABEL_SETUP.name},
      ${DEMO_LABEL_SETUP.widthMm}, ${DEMO_LABEL_SETUP.heightMm},
      ${transaction.json(DEMO_LABEL_SETUP.elements)}, 1,
      ${DEMO_ACTOR}, ${DEMO_ACTOR}, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      width_mm = excluded.width_mm,
      height_mm = excluded.height_mm,
      elements = excluded.elements,
      revision = 1,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  if (preparedMedia.length === 0) {
    await transaction`
      DELETE FROM media
      WHERE organization_id = ${DEMO_ORGANIZATION.id}
        AND id = ANY(${DEMO_MEDIA.map(({ id }) => id)})
    `;
  } else {
    for (const media of preparedMedia) {
      const storageKey = `${mediaStoragePrefix}/${media.filename}`;
      await transaction`
        INSERT INTO media (
          organization_id, id, resource_id, storage_key, url, name, mime_type,
          kind, size, width, height, position, alt_text, source
        ) VALUES (
          ${DEMO_ORGANIZATION.id}, ${media.id}, ${media.resourceId},
          ${storageKey}, ${`/api/files/${storageKey}`}, ${media.filename},
          'image/webp', 'image', ${media.size}, ${media.width}, ${media.height},
          0, ${media.altText}, 'demo-context'
        )
        ON CONFLICT (id) DO UPDATE SET
          resource_id = excluded.resource_id,
          storage_key = excluded.storage_key,
          url = excluded.url,
          name = excluded.name,
          mime_type = excluded.mime_type,
          kind = excluded.kind,
          size = excluded.size,
          width = excluded.width,
          height = excluded.height,
          position = excluded.position,
          alt_text = excluded.alt_text,
          source = excluded.source
      `;
    }
  }

  await transaction`
    DELETE FROM notification_preferences
    WHERE organization_id = ${DEMO_ORGANIZATION.id}
      AND recipient_key <> ${configuration.email}
  `;
  await transaction`
    INSERT INTO notification_preferences (
      organization_id, recipient_key, recipient_email, recipient_name,
      enabled_event_types, frequency, digest_hour, timezone, locale,
      cooldown_hours, low_stock_threshold_percent, expiry_window_days,
      expiry_field_key, maintenance_window_days, maintenance_field_key,
      return_due_window_days, email_enabled, push_enabled, slack_enabled,
      teams_enabled, webhook_enabled, updated_at
    ) VALUES (
      ${DEMO_ORGANIZATION.id}, ${configuration.email}, ${configuration.email},
      ${DEMO_USER.name}, ${["low_stock", "expiry", "maintenance", "return_due"]},
      'daily', 8, 'Europe/Berlin', 'de', 24, 100, 30, 'expiry_date', 7,
      'maintenance_due', 3, false, false, false, false, false, now()
    )
    ON CONFLICT (organization_id, recipient_key) DO UPDATE SET
      recipient_email = excluded.recipient_email,
      recipient_name = excluded.recipient_name,
      enabled_event_types = excluded.enabled_event_types,
      frequency = excluded.frequency,
      digest_hour = excluded.digest_hour,
      timezone = excluded.timezone,
      locale = excluded.locale,
      cooldown_hours = excluded.cooldown_hours,
      low_stock_threshold_percent = excluded.low_stock_threshold_percent,
      expiry_window_days = excluded.expiry_window_days,
      expiry_field_key = excluded.expiry_field_key,
      maintenance_window_days = excluded.maintenance_window_days,
      maintenance_field_key = excluded.maintenance_field_key,
      return_due_window_days = excluded.return_due_window_days,
      email_enabled = false,
      push_enabled = false,
      slack_enabled = false,
      teams_enabled = false,
      webhook_enabled = false,
      updated_at = now()
  `;

  // Keep this as the final data mutation. A partially completed seed must never
  // advertise a writable public organization as a finished demo tenant.
  await transaction`
    UPDATE organizations
    SET is_read_only = true, updated_at = now()
    WHERE id = ${DEMO_ORGANIZATION.id}
  `;
}

async function removeDemo(transaction, configuration) {
  const [organization] = await transaction`
    SELECT id, name, slug, is_read_only
    FROM organizations
    WHERE id = ${DEMO_ORGANIZATION.id}
    FOR UPDATE
  `;
  const [user] = await transaction`
    SELECT id, email, name, role
    FROM users
    WHERE id = ${DEMO_USER.id}
    FOR UPDATE
  `;

  const organizationMemberships = organization
    ? await transaction`
      SELECT user_id, role_key, is_active
      FROM organization_memberships
      WHERE organization_id = ${DEMO_ORGANIZATION.id}
      FOR UPDATE
    `
    : [];
  const userMemberships = user
    ? await transaction`
      SELECT organization_id, role_key, is_active
      FROM organization_memberships
      WHERE user_id = ${DEMO_USER.id}
      FOR UPDATE
    `
    : [];
  const stateErrors = validateDemoRemovalState({
    configuration,
    organization: organization ?? null,
    user: user ?? null,
    organizationMemberships,
    userMemberships,
  });
  if (stateErrors.length > 0) {
    throw new Error(`Demo cleanup refused:\n- ${stateErrors.join("\n- ")}`);
  }

  if (organization) {
    const removed = await transaction`
      DELETE FROM organizations
      WHERE id = ${DEMO_ORGANIZATION.id}
        AND name = ${DEMO_ORGANIZATION.name}
        AND slug = ${configuration.slug}
        AND is_read_only = true
      RETURNING id
    `;
    if (removed.length !== 1) {
      throw new Error("The verified demo organization changed during cleanup; transaction rolled back.");
    }
  }

  if (user) {
    const [remainingMembership] = await transaction`
      SELECT organization_id
      FROM organization_memberships
      WHERE user_id = ${DEMO_USER.id}
      LIMIT 1
    `;
    if (remainingMembership) {
      throw new Error("The demo user still has a membership after organization cleanup; transaction rolled back.");
    }
    const removed = await transaction`
      DELETE FROM users
      WHERE id = ${DEMO_USER.id}
        AND email = ${configuration.email}
        AND name = ${DEMO_USER.name}
        AND role = 'viewer'
      RETURNING id
    `;
    if (removed.length !== 1) {
      throw new Error("The verified demo user changed during cleanup; transaction rolled back.");
    }
  }
}

const manifestErrors = validateDemoSeedManifest();
if (manifestErrors.length > 0) {
  throw new Error(`Invalid demo seed manifest:\n- ${manifestErrors.join("\n- ")}`);
}

const configuration = demoConfiguration();
if (!enabled && !removeRequested) {
  process.stdout.write(
    "Demo seed skipped; set DEMO_ACCESS_ENABLED=true to create or reconcile it.\n",
  );
} else {
  const preparedMedia = removeRequested ? [] : await prepareLocalMedia();
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(${DEMO_LOCK_ID})`;
      await assertSchemaIsReady(transaction);
      if (removeRequested) {
        await removeDemo(transaction, configuration);
      } else {
        await assertIdentitySlotsAreSafe(transaction, configuration);
        // The public tenant is disposable product data, so rebuild it from the
        // fixed manifest on every reconciliation. This prevents stale rows,
        // shares, tokens, jobs, or media records from an older demo version
        // from becoming publicly visible after a deploy.
        await removeDemo(transaction, configuration);
        await assertTenantRowIdsAreSafe(transaction);
        await seedDemo(transaction, configuration, preparedMedia);
      }
    });
  } finally {
    await sql.end();
  }

  if (removeRequested) {
    await removeLocalMedia();
    process.stdout.write(
      `Removed verified demo organization ${DEMO_ORGANIZATION.id}, its dedicated user when present, and exact local demo media keys.\n`,
    );
  } else {
    process.stdout.write(
      `Reconciled demo seed v${DEMO_SEED_VERSION}: ${DEMO_ORGANIZATION.name} (${configuration.slug}), ${DEMO_RESOURCES.length} records, read-only.\n`,
    );
  }
}
