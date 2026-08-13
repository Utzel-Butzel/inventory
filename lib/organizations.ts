import "server-only";

import { and, asc, eq } from "drizzle-orm";

import {
  accessRoles,
  DEFAULT_ORGANIZATION_ID,
  inventoryTypeDefinitions,
  organizationMemberships,
  organizations,
  relationTypeDefinitions,
  translationLanguages,
  type UserRole,
} from "@/db/schema";
import { builtinRolePermissions } from "@/lib/access-control-contract";
import { db } from "@/lib/db";

export const ORGANIZATION_HEADER = "x-organization-id";
export const ORGANIZATION_COOKIE = "inventory.organization";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
};

export type OrganizationMembershipSummary = OrganizationSummary & {
  role: UserRole;
  roleName: string;
};

const systemRoles = [
  {
    key: "admin",
    name: "Admin",
    description:
      "Full organization access, including users, roles, settings, and API tokens.",
  },
  {
    key: "editor",
    name: "Editor",
    description:
      "Can work with inventory and operational workflows without organization administration.",
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to inventory and operational records.",
  },
] as const;

// New organizations are seeded from immutable application-owned templates.
// Never copy these rows from the legacy organization: its labels, descriptions,
// and translation instructions are tenant-editable data.
const canonicalInventoryTypes = [
  {
    key: "place",
    label: "Place / room",
    description: "A site, building, room, zone, shelf, or other place.",
    color: "#16a374",
    icon: "map-pin",
    canContain: true,
    spatialContainment: true,
    position: 10,
  },
  {
    key: "furniture",
    label: "Furniture",
    description: "Furniture and fixtures which may contain other items.",
    color: "#b9875e",
    icon: "armchair",
    canContain: true,
    spatialContainment: true,
    position: 20,
  },
  {
    key: "vehicle",
    label: "Vehicle",
    description: "Vehicles and mobile containers.",
    color: "#3b82f6",
    icon: "car",
    canContain: true,
    spatialContainment: true,
    position: 30,
  },
  {
    key: "tool",
    label: "Tool",
    description: "Tools and workshop equipment.",
    color: "#e99b2d",
    icon: "wrench",
    canContain: false,
    spatialContainment: false,
    position: 40,
  },
  {
    key: "object",
    label: "Object",
    description: "General physical objects and stock items.",
    color: "#635bff",
    icon: "box",
    canContain: false,
    spatialContainment: false,
    position: 50,
  },
  {
    key: "clothing",
    label: "Clothing",
    description: "Clothing and wearable equipment.",
    color: "#e2647f",
    icon: "shirt",
    canContain: false,
    spatialContainment: false,
    position: 60,
  },
  {
    key: "person",
    label: "Person",
    description: "A person represented inside the inventory graph.",
    color: "#a66dd4",
    icon: "user",
    canContain: false,
    spatialContainment: false,
    position: 70,
  },
  {
    key: "project",
    label: "Project",
    description: "A project or logical collection.",
    color: "#64748b",
    icon: "folder",
    canContain: true,
    spatialContainment: false,
    position: 80,
  },
  {
    key: "other",
    label: "Other",
    description: "Fallback type for records which do not fit another type.",
    color: "#858b95",
    icon: "shapes",
    canContain: false,
    spatialContainment: false,
    position: 90,
  },
] as const;

const canonicalRelationTypes = [
  {
    key: "contains",
    label: "Contains",
    inverseLabel: "Located in",
    description:
      "Physical or logical containment. Spatial edges are recalculated from map geometry.",
    allowManual: true,
    spatial: true,
    position: 10,
  },
  {
    key: "related",
    label: "Related to",
    inverseLabel: "Related to",
    description: "A general relationship without containment semantics.",
    allowManual: true,
    spatial: false,
    position: 20,
  },
] as const;

export const organizationSummary = (
  organization: Pick<typeof organizations.$inferSelect, "id" | "name" | "slug">,
): OrganizationSummary => ({
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
});

export async function getOrganization(id: string) {
  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return organization ?? null;
}

export async function listOrganizationsForUser(
  userId: string,
): Promise<OrganizationMembershipSummary[]> {
  const rows = await db
    .select({
      organization: organizations,
      role: organizationMemberships.roleKey,
      roleName: accessRoles.name,
    })
    .from(organizationMemberships)
    .innerJoin(
      organizations,
      eq(organizationMemberships.organizationId, organizations.id),
    )
    .innerJoin(
      accessRoles,
      and(
        eq(accessRoles.organizationId, organizationMemberships.organizationId),
        eq(accessRoles.key, organizationMemberships.roleKey),
      ),
    )
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.isActive, true),
      ),
    )
    .orderBy(asc(organizations.name), asc(organizations.id));

  return rows.map(({ organization, role, roleName }) => ({
    ...organizationSummary(organization),
    role,
    roleName,
  }));
}

export function selectOrganization(
  memberships: readonly OrganizationMembershipSummary[],
  requestedId?: string | null,
  fallbackId?: string | null,
) {
  const requested = requestedId?.trim();
  if (requested) {
    return memberships.find((membership) => membership.id === requested) ?? null;
  }
  const fallback = fallbackId?.trim();
  if (fallback) {
    const match = memberships.find((membership) => membership.id === fallback);
    if (match) return match;
  }
  return (
    memberships.find(
      (membership) => membership.id === DEFAULT_ORGANIZATION_ID,
    ) ?? memberships[0] ?? null
  );
}

export async function ensureDefaultOrganizationMembership(options: {
  userId: string;
  role: UserRole;
  actor: string;
}) {
  await db
    .insert(organizationMemberships)
    .values({
      organizationId: DEFAULT_ORGANIZATION_ID,
      userId: options.userId,
      roleKey: options.role,
      createdBy: options.actor,
    })
    .onConflictDoNothing({
      target: [
        organizationMemberships.organizationId,
        organizationMemberships.userId,
      ],
    });
}

function slugBase(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || "organization";
}

async function copyOrganizationDefaults(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  actor: string,
) {
  await transaction.insert(accessRoles).values(
    systemRoles.map((role) => ({
      organizationId,
      ...role,
      permissions: [...builtinRolePermissions[role.key]],
      isSystem: true,
      createdBy: actor,
      updatedBy: actor,
    })),
  );

  await transaction.insert(inventoryTypeDefinitions).values(
    canonicalInventoryTypes.map((type) => ({
      organizationId,
      ...type,
      isSystem: true,
      createdBy: actor,
      updatedBy: actor,
    })),
  );
  await transaction.insert(relationTypeDefinitions).values(
    canonicalRelationTypes.map((relation) => ({
      organizationId,
      ...relation,
      isSystem: true,
      createdBy: actor,
      updatedBy: actor,
    })),
  );
  await transaction.insert(translationLanguages).values({
    organizationId,
    code: "en",
    label: "English",
    isDefault: true,
    autoTranslate: false,
    instructions: "",
    position: 0,
    createdBy: actor,
    updatedBy: actor,
  });
}

export async function createOrganization(options: {
  name: string;
  userId: string;
  actor: string;
}) {
  return db.transaction(async (transaction) => {
    const base = slugBase(options.name);
    let created: typeof organizations.$inferSelect | undefined;
    for (let attempt = 0; attempt < 25 && !created; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const slug = `${base.slice(0, 80 - suffix.length)}${suffix}`;
      [created] = await transaction
        .insert(organizations)
        .values({
          name: options.name,
          slug,
          createdBy: options.actor,
        })
        .onConflictDoNothing({ target: organizations.slug })
        .returning();
    }
    if (!created) throw new Error("Unable to allocate an organization slug.");

    await copyOrganizationDefaults(
      transaction,
      created.id,
      options.actor,
    );
    await transaction.insert(organizationMemberships).values({
      organizationId: created.id,
      userId: options.userId,
      roleKey: "admin",
      createdBy: options.actor,
    });
    return organizationSummary(created);
  });
}

export async function updateOrganization(options: {
  id: string;
  name: string;
  actor: string;
}) {
  const [updated] = await db
    .update(organizations)
    .set({ name: options.name, updatedAt: new Date() })
    .where(eq(organizations.id, options.id))
    .returning();
  return updated ? organizationSummary(updated) : null;
}
