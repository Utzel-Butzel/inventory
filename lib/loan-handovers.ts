import "server-only";

import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { loanHandovers, resources, users, organizationMemberships, type InventoryAssignmentRecord } from "@/db/schema";
import { db, type DatabaseTransaction } from "@/lib/db";
import { loanHandoverSchema, type LoanHandoverInput, type LoanHandoverDocument } from "@/lib/loan-handover-contract";

export async function normalizeHandoverPhotos(input: LoanHandoverInput) {
  const validated = loanHandoverSchema.parse(input);
  const photos: string[] = [];
  // Decode real raster images, bound decompressed pixels, strip metadata and keep
  // independent copies so deleting an item's gallery cannot change the report.
  for (const photo of validated.photos) {
    const source = Buffer.from(photo.slice(photo.indexOf(",") + 1), "base64");
    const raster = sharp(source, { limitInputPixels: 25_000_000, failOn: "warning" });
    const metadata = await raster.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) {
      throw new Error("Only still JPEG, PNG and WebP photos are supported.");
    }
    const bytes = await raster.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    photos.push(`data:image/jpeg;base64,${bytes.toString("base64")}`);
  }
  return { ...validated, photos };
}

export async function saveLoanHandover(
  transaction: DatabaseTransaction,
  assignment: InventoryAssignmentRecord,
  resourceName: string,
  unitCode: string | null,
  phase: "checkout" | "return",
  input: LoanHandoverInput,
  actor: string,
  recordedAt: Date,
  occurredAt: Date,
) {
  let borrower = assignment.assigneeLabel;
  if (assignment.assigneeUserId) {
    const [user] = await transaction.select({ name: users.name }).from(users)
      .innerJoin(organizationMemberships, and(eq(organizationMemberships.userId, users.id), eq(organizationMemberships.organizationId, assignment.organizationId)))
      .where(eq(users.id, assignment.assigneeUserId)).limit(1);
    borrower = user?.name ?? "User";
  } else if (assignment.assigneeResourceId) {
    const [resource] = await transaction.select({ name: resources.name }).from(resources)
      .where(and(eq(resources.organizationId, assignment.organizationId), eq(resources.id, assignment.assigneeResourceId))).limit(1);
    borrower = resource?.name ?? "Inventory item";
  }
  const document: LoanHandoverDocument = {
    ...input, version: 1, phase, assignmentId: assignment.id,
    resourceId: assignment.resourceId, resourceName, unitCode,
    quantity: assignment.quantity, borrower, dueAt: assignment.dueAt?.toISOString() ?? null,
    occurredAt: occurredAt.toISOString(), recordedAt: recordedAt.toISOString(), recordedBy: actor,
  };
  await transaction.insert(loanHandovers).values({
    organizationId: assignment.organizationId, assignmentId: assignment.id, phase, document, createdAt: recordedAt,
  });
}

export async function getLoanHandovers(organizationId: string, assignmentId: string) {
  const rows = await db.select({ document: loanHandovers.document }).from(loanHandovers)
    .where(and(eq(loanHandovers.organizationId, organizationId), eq(loanHandovers.assignmentId, assignmentId)))
    .orderBy(loanHandovers.createdAt);
  return rows.map((row) => row.document);
}
