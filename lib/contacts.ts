import "server-only";

import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import {
  contactComments,
  contactResources,
  contacts,
  resources,
  stockMovements,
  type ContactRecord,
} from "@/db/schema";
import type {
  ContactInput,
  ContactPatch,
  ContactRole,
} from "@/lib/contact-contract";
import { db } from "@/lib/db";

export class ContactOperationError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 422,
  ) {
    super(message);
    this.name = "ContactOperationError";
  }
}

const nullable = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const rowDto = (
  row: ContactRecord,
  linkedResources: Array<{
    id: string;
    name: string;
    sku: string | null;
    type: string;
  }>,
  movementCount: number,
  commentCount: number,
) => ({
  id: row.id,
  name: row.name,
  company: row.company,
  roles: row.roles,
  email: row.email,
  phone: row.phone,
  website: row.website,
  customerNumber: row.customerNumber,
  supplierNumber: row.supplierNumber,
  taxId: row.taxId,
  addressLine1: row.addressLine1,
  addressLine2: row.addressLine2,
  postalCode: row.postalCode,
  city: row.city,
  state: row.state,
  countryCode: row.countryCode,
  tags: row.tags,
  notes: row.notes,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  resources: linkedResources,
  movementCount,
  commentCount,
});

async function hydrateContacts(
  organizationId: string,
  rows: ContactRecord[],
) {
  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];

  const [links, movementCounts, commentCounts] = await Promise.all([
    db
      .select({
        contactId: contactResources.contactId,
        id: resources.id,
        name: resources.name,
        sku: resources.sku,
        type: resources.type,
      })
      .from(contactResources)
      .innerJoin(
        resources,
        and(
          eq(resources.organizationId, contactResources.organizationId),
          eq(resources.id, contactResources.resourceId),
        ),
      )
      .where(
        and(
          eq(contactResources.organizationId, organizationId),
          inArray(contactResources.contactId, ids),
        ),
      )
      .orderBy(asc(resources.name)),
    db
      .select({
        contactId: stockMovements.contactId,
        count: count(stockMovements.id),
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          inArray(stockMovements.contactId, ids),
        ),
      )
      .groupBy(stockMovements.contactId),
    db
      .select({
        contactId: contactComments.contactId,
        count: count(contactComments.id),
      })
      .from(contactComments)
      .where(
        and(
          eq(contactComments.organizationId, organizationId),
          inArray(contactComments.contactId, ids),
        ),
      )
      .groupBy(contactComments.contactId),
  ]);

  const resourcesByContact = new Map<
    string,
    Array<{ id: string; name: string; sku: string | null; type: string }>
  >();
  for (const link of links) {
    const current = resourcesByContact.get(link.contactId) ?? [];
    current.push({ id: link.id, name: link.name, sku: link.sku, type: link.type });
    resourcesByContact.set(link.contactId, current);
  }
  const countsByContact = new Map(
    movementCounts.flatMap((entry) =>
      entry.contactId ? [[entry.contactId, Number(entry.count)]] : [],
    ),
  );
  const commentCountsByContact = new Map(
    commentCounts.map((entry) => [entry.contactId, Number(entry.count)]),
  );

  return rows.map((row) =>
    rowDto(
      row,
      resourcesByContact.get(row.id) ?? [],
      countsByContact.get(row.id) ?? 0,
      commentCountsByContact.get(row.id) ?? 0,
    ),
  );
}

export async function listContacts(options: {
  organizationId: string;
  query?: string;
  role?: ContactRole;
  includeArchived?: boolean;
}) {
  const query = options.query?.trim();
  let condition = eq(contacts.organizationId, options.organizationId);
  if (!options.includeArchived) {
    condition = and(condition, isNull(contacts.archivedAt))!;
  }
  if (options.role) {
    condition = and(
      condition,
      sql`${options.role} = any(${contacts.roles})`,
    )!;
  }
  if (query) {
    const pattern = `%${query}%`;
    condition = and(
      condition,
      or(
        ilike(contacts.name, pattern),
        ilike(contacts.company, pattern),
        ilike(contacts.email, pattern),
        ilike(contacts.customerNumber, pattern),
        ilike(contacts.supplierNumber, pattern),
      ),
    )!;
  }
  const rows = await db
    .select()
    .from(contacts)
    .where(condition)
    .orderBy(asc(contacts.name), asc(contacts.company));
  return hydrateContacts(options.organizationId, rows);
}

export async function getContact(organizationId: string, contactId: string) {
  const [row] = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, organizationId),
        eq(contacts.id, contactId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [contact] = await hydrateContacts(organizationId, [row]);
  return contact ?? null;
}

async function assertResourcesExist(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  resourceIds: string[],
) {
  if (!resourceIds.length) return;
  const rows = await transaction
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        inArray(resources.id, resourceIds),
      ),
    );
  if (rows.length !== resourceIds.length) {
    throw new ContactOperationError(
      "One or more assigned inventory items do not exist in this organization.",
      422,
    );
  }
}

export async function createContact(
  organizationId: string,
  input: ContactInput,
  actor: string,
) {
  const contactId = await db.transaction(async (transaction) => {
    await assertResourcesExist(transaction, organizationId, input.resourceIds);
    const [created] = await transaction
      .insert(contacts)
      .values({
        organizationId,
        name: input.name.trim(),
        company: nullable(input.company),
        roles: input.roles,
        email: nullable(input.email),
        phone: nullable(input.phone),
        website: nullable(input.website),
        customerNumber: nullable(input.customerNumber),
        supplierNumber: nullable(input.supplierNumber),
        taxId: nullable(input.taxId),
        addressLine1: nullable(input.addressLine1),
        addressLine2: nullable(input.addressLine2),
        postalCode: nullable(input.postalCode),
        city: nullable(input.city),
        state: nullable(input.state),
        countryCode: nullable(input.countryCode)?.toUpperCase() ?? null,
        tags: input.tags,
        notes: input.notes ?? "",
        createdBy: actor,
        updatedBy: actor,
      })
      .returning({ id: contacts.id });
    if (!created) throw new ContactOperationError("Unable to create contact.", 409);
    if (input.resourceIds.length) {
      await transaction.insert(contactResources).values(
        input.resourceIds.map((resourceId) => ({
          organizationId,
          contactId: created.id,
          resourceId,
          createdBy: actor,
        })),
      );
    }
    return created.id;
  });
  const contact = await getContact(organizationId, contactId);
  if (!contact) throw new ContactOperationError("Unable to load contact.", 409);
  return contact;
}

export async function updateContact(
  organizationId: string,
  contactId: string,
  input: ContactPatch,
  actor: string,
) {
  await db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.organizationId, organizationId),
          eq(contacts.id, contactId),
        ),
      )
      .limit(1);
    if (!existing) throw new ContactOperationError("Contact not found.", 404);

    if (input.resourceIds) {
      await assertResourcesExist(transaction, organizationId, input.resourceIds);
    }
    const values: Partial<typeof contacts.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: actor,
    };
    if (input.name !== undefined) values.name = input.name.trim();
    if (input.company !== undefined) values.company = nullable(input.company);
    if (input.roles !== undefined) values.roles = input.roles;
    if (input.email !== undefined) values.email = nullable(input.email);
    if (input.phone !== undefined) values.phone = nullable(input.phone);
    if (input.website !== undefined) values.website = nullable(input.website);
    if (input.customerNumber !== undefined) {
      values.customerNumber = nullable(input.customerNumber);
    }
    if (input.supplierNumber !== undefined) {
      values.supplierNumber = nullable(input.supplierNumber);
    }
    if (input.taxId !== undefined) values.taxId = nullable(input.taxId);
    if (input.addressLine1 !== undefined) {
      values.addressLine1 = nullable(input.addressLine1);
    }
    if (input.addressLine2 !== undefined) {
      values.addressLine2 = nullable(input.addressLine2);
    }
    if (input.postalCode !== undefined) {
      values.postalCode = nullable(input.postalCode);
    }
    if (input.city !== undefined) values.city = nullable(input.city);
    if (input.state !== undefined) values.state = nullable(input.state);
    if (input.countryCode !== undefined) {
      values.countryCode = nullable(input.countryCode)?.toUpperCase() ?? null;
    }
    if (input.tags !== undefined) values.tags = input.tags;
    if (input.notes !== undefined) values.notes = input.notes;

    await transaction
      .update(contacts)
      .set(values)
      .where(
        and(
          eq(contacts.organizationId, organizationId),
          eq(contacts.id, contactId),
        ),
      );

    if (input.resourceIds) {
      await transaction
        .delete(contactResources)
        .where(
          and(
            eq(contactResources.organizationId, organizationId),
            eq(contactResources.contactId, contactId),
          ),
        );
      if (input.resourceIds.length) {
        await transaction.insert(contactResources).values(
          input.resourceIds.map((resourceId) => ({
            organizationId,
            contactId,
            resourceId,
            createdBy: actor,
          })),
        );
      }
    }
  });
  const contact = await getContact(organizationId, contactId);
  if (!contact) throw new ContactOperationError("Contact not found.", 404);
  return contact;
}

export async function archiveContact(
  organizationId: string,
  contactId: string,
  actor: string,
) {
  const [archived] = await db
    .update(contacts)
    .set({ archivedAt: new Date(), updatedAt: new Date(), updatedBy: actor })
    .where(
      and(
        eq(contacts.organizationId, organizationId),
        eq(contacts.id, contactId),
        isNull(contacts.archivedAt),
      ),
    )
    .returning({ id: contacts.id });
  if (!archived) throw new ContactOperationError("Contact not found.", 404);
}

export function contactHttpError(error: unknown, fallback: string) {
  if (error instanceof ContactOperationError) {
    return { status: error.status, message: error.message };
  }
  return { status: 500 as const, message: fallback };
}
