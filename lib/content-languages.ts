import "server-only";

import { and, asc, count, eq, isNull } from "drizzle-orm";

import {
  resourceTranslationJobs,
  resourceTranslations,
  translationLanguages,
  type TranslationLanguageRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import { normalizeLanguageCode } from "@/lib/translation-contract";

export type TranslationLanguageInput = {
  code: string;
  label: string;
  isDefault?: boolean;
  autoTranslate?: boolean;
  instructions?: string;
  position?: number;
};

export async function listTranslationLanguages(
  organizationId: string,
  includeArchived = false,
) {
  return db
    .select()
    .from(translationLanguages)
    .where(
      and(
        eq(translationLanguages.organizationId, organizationId),
        ...(includeArchived
          ? []
          : [isNull(translationLanguages.archivedAt)]),
      ),
    )
    .orderBy(
      asc(translationLanguages.position),
      asc(translationLanguages.label),
    );
}

export async function getDefaultTranslationLanguage(organizationId: string) {
  const [language] = await db
    .select()
    .from(translationLanguages)
    .where(
      and(
        eq(translationLanguages.organizationId, organizationId),
        isNull(translationLanguages.archivedAt),
        eq(translationLanguages.isDefault, true),
      ),
    )
    .limit(1);
  return language ?? null;
}

export async function createTranslationLanguage(
  organizationId: string,
  input: TranslationLanguageInput,
  actor: string,
) {
  const code = normalizeLanguageCode(input.code);
  return db.transaction(async (transaction) => {
    const active = await transaction
      .select()
      .from(translationLanguages)
      .where(
        and(
          eq(translationLanguages.organizationId, organizationId),
          isNull(translationLanguages.archivedAt),
        ),
      )
      .orderBy(asc(translationLanguages.position))
      .for("update");
    const makeDefault = input.isDefault === true || active.length === 0;
    if (makeDefault && active.some((language) => language.isDefault)) {
      const [[{ value: translationCount }], [{ value: jobCount }]] =
        await Promise.all([
          transaction
            .select({ value: count() })
            .from(resourceTranslations)
            .where(eq(resourceTranslations.organizationId, organizationId)),
          transaction
            .select({ value: count() })
            .from(resourceTranslationJobs)
            .where(eq(resourceTranslationJobs.organizationId, organizationId)),
        ]);
      if (translationCount > 0 || jobCount > 0) {
        throw new Error("DEFAULT_LANGUAGE_LOCKED");
      }
      await transaction
        .update(translationLanguages)
        .set({ isDefault: false, updatedBy: actor, updatedAt: new Date() })
        .where(
          and(
            eq(translationLanguages.organizationId, organizationId),
            eq(translationLanguages.isDefault, true),
          ),
        );
    }
    const [created] = await transaction
      .insert(translationLanguages)
      .values({
        organizationId,
        code,
        label: input.label.trim(),
        isDefault: makeDefault,
        autoTranslate: makeDefault ? false : input.autoTranslate !== false,
        instructions: input.instructions?.trim() ?? "",
        position: input.position ?? active.length * 10,
        createdBy: actor,
        updatedBy: actor,
      })
      .returning();
    return created;
  });
}

export async function updateTranslationLanguage(
  organizationId: string,
  codeInput: string,
  patch: Partial<
    Pick<
      TranslationLanguageRecord,
      "label" | "autoTranslate" | "instructions" | "position" | "isDefault"
    >
  > & { archived?: boolean },
  actor: string,
) {
  const code = normalizeLanguageCode(codeInput);
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(translationLanguages)
      .where(
        and(
          eq(translationLanguages.organizationId, organizationId),
          eq(translationLanguages.code, code),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) throw new Error("LANGUAGE_NOT_FOUND");
    if (patch.archived === true && current.isDefault) {
      throw new Error("DEFAULT_LANGUAGE_REQUIRED");
    }
    if (patch.isDefault === false && current.isDefault) {
      throw new Error("DEFAULT_LANGUAGE_REQUIRED");
    }
    if (patch.isDefault === true && !current.isDefault) {
      const [[{ value: translationCount }], [{ value: jobCount }]] =
        await Promise.all([
          transaction
            .select({ value: count() })
            .from(resourceTranslations)
            .where(eq(resourceTranslations.organizationId, organizationId)),
          transaction
            .select({ value: count() })
            .from(resourceTranslationJobs)
            .where(eq(resourceTranslationJobs.organizationId, organizationId)),
        ]);
      if (translationCount > 0 || jobCount > 0) {
        throw new Error("DEFAULT_LANGUAGE_LOCKED");
      }
      await transaction
        .update(translationLanguages)
        .set({ isDefault: false, updatedBy: actor, updatedAt: new Date() })
        .where(
          and(
            eq(translationLanguages.organizationId, organizationId),
            eq(translationLanguages.isDefault, true),
          ),
        );
    }

    const [updated] = await transaction
      .update(translationLanguages)
      .set({
        ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
        ...(patch.instructions !== undefined
          ? { instructions: patch.instructions.trim() }
          : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
        ...(patch.isDefault === true
          ? { isDefault: true, autoTranslate: false }
          : {}),
        ...(patch.autoTranslate !== undefined
          ? { autoTranslate: patch.isDefault === true ? false : patch.autoTranslate }
          : {}),
        ...(patch.archived === true
          ? { archivedAt: new Date(), autoTranslate: false }
          : patch.archived === false
            ? { archivedAt: null }
            : {}),
        updatedBy: actor,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(translationLanguages.organizationId, organizationId),
          eq(translationLanguages.code, code),
        ),
      )
      .returning();
    return updated;
  });
}

export function contentLanguageHttpError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "LANGUAGE_NOT_FOUND") {
    return { status: 404, message: "Language not found." };
  }
  if (message === "DEFAULT_LANGUAGE_REQUIRED") {
    return { status: 409, message: "The default language cannot be archived or unset." };
  }
  if (message === "DEFAULT_LANGUAGE_LOCKED") {
    return {
      status: 409,
      message:
        "The default language cannot change after translations exist. Changing it would relabel the canonical source without rebuilding every translation.",
    };
  }
  if (message.includes("translation_languages_pkey")) {
    return { status: 409, message: "That language code is already configured." };
  }
  if (message.includes("BCP 47")) {
    return { status: 422, message };
  }
  return {
    status: 500,
    message: message || "Unable to update translation languages.",
  };
}
