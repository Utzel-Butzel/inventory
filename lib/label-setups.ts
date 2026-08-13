import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { labelSetups, type LabelSetupRecord } from "@/db/schema";
import { db } from "@/lib/db";
import type {
  LabelSetupCreate,
  LabelSetupDto,
  LabelSetupPatch,
} from "@/lib/label-setup-contract";

export class LabelSetupError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 | 500 = 422,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LabelSetupError";
  }
}

export function labelSetupHttpError(error: unknown, fallback: string) {
  if (error instanceof LabelSetupError) {
    return {
      status: error.status,
      message: error.message,
      details: error.details,
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("label_setups_name_unique")) {
    return {
      status: 409 as const,
      message: "A label setup with that name already exists.",
      details: undefined,
    };
  }
  return { status: 500 as const, message: fallback, details: undefined };
}

const labelSetupDto = (row: LabelSetupRecord): LabelSetupDto => ({
  id: row.id,
  name: row.name,
  widthMm: row.widthMm,
  heightMm: row.heightMm,
  elements: row.elements,
  revision: row.revision,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export async function listLabelSetups(organizationId: string) {
  const rows = await db
    .select()
    .from(labelSetups)
    .where(eq(labelSetups.organizationId, organizationId))
    .orderBy(asc(labelSetups.name), asc(labelSetups.id));
  return rows.map(labelSetupDto);
}

export async function getLabelSetup(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(labelSetups)
    .where(
      and(
        eq(labelSetups.organizationId, organizationId),
        eq(labelSetups.id, id),
      ),
    )
    .limit(1);
  return row ? labelSetupDto(row) : null;
}

export async function createLabelSetup(
  organizationId: string,
  input: LabelSetupCreate,
  actor: string,
) {
  try {
    const [created] = await db
      .insert(labelSetups)
      .values({
        ...input,
        organizationId,
        createdBy: actor,
        updatedBy: actor,
      })
      .returning();
    return labelSetupDto(created);
  } catch (error) {
    const failure = labelSetupHttpError(
      error,
      "Unable to create the label setup.",
    );
    throw new LabelSetupError(failure.message, failure.status, failure.details);
  }
}

export async function updateLabelSetup(
  organizationId: string,
  id: string,
  patch: LabelSetupPatch,
  actor: string,
) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(labelSetups)
      .where(
        and(
          eq(labelSetups.organizationId, organizationId),
          eq(labelSetups.id, id),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) {
      throw new LabelSetupError("Label setup not found.", 404);
    }
    if (current.revision !== patch.revision) {
      throw new LabelSetupError(
        "The label setup was changed by another request. Reload it and try again.",
        409,
        { currentRevision: current.revision },
      );
    }

    const { revision, ...changes } = patch;
    try {
      const [saved] = await transaction
        .update(labelSetups)
        .set({
          ...changes,
          revision: sql`${labelSetups.revision} + 1`,
          updatedBy: actor,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(labelSetups.organizationId, organizationId),
            eq(labelSetups.id, id),
            eq(labelSetups.revision, revision),
          ),
        )
        .returning();
      if (!saved) {
        throw new LabelSetupError(
          "The label setup was changed by another request. Reload it and try again.",
          409,
        );
      }
      return labelSetupDto(saved);
    } catch (error) {
      const failure = labelSetupHttpError(
        error,
        "Unable to update the label setup.",
      );
      throw new LabelSetupError(failure.message, failure.status, failure.details);
    }
  });
}

export async function deleteLabelSetup(
  organizationId: string,
  id: string,
  revision: number,
) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select({ revision: labelSetups.revision })
      .from(labelSetups)
      .where(
        and(
          eq(labelSetups.organizationId, organizationId),
          eq(labelSetups.id, id),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) throw new LabelSetupError("Label setup not found.", 404);
    if (current.revision !== revision) {
      throw new LabelSetupError(
        "The label setup was changed by another request. Reload it and try again.",
        409,
        { currentRevision: current.revision },
      );
    }

    const [deleted] = await transaction
      .delete(labelSetups)
      .where(
        and(
          eq(labelSetups.organizationId, organizationId),
          eq(labelSetups.id, id),
          eq(labelSetups.revision, revision),
        ),
      )
      .returning({ id: labelSetups.id });
    if (!deleted) {
      throw new LabelSetupError(
        "The label setup was changed by another request. Reload it and try again.",
        409,
      );
    }
  });
}
