import { extractScanRegexValue, scanRegexValidationError } from "@/lib/scan-regex";
import type { TFunction } from "i18next";
import type { WorkflowDraft } from "./types";

export function validateDraft(draft: WorkflowDraft, t: TFunction) {
  if (!draft.name.trim()) return t("workflows.validation.name");
  if (!draft.resourceIds.length) return t("workflows.validation.resource");
  if (!draft.codeTypes.length) return t("workflows.validation.codeType");
  if (!draft.identifierPropertyKey.trim()) return t("workflows.validation.identifier");
  const validPropertyKey = /^[A-Za-z0-9_.-]+$/;
  if (!validPropertyKey.test(draft.identifierPropertyKey.trim())) {
    return t("workflows.validation.propertyKey");
  }
  if (draft.extraction.mode === "url-query") {
    if (!draft.extraction.parameter.trim()) return t("workflows.validation.queryParameter");
    if (draft.extraction.sourceOrigin.trim()) {
      try {
        const sourceOrigin = draft.extraction.sourceOrigin.trim();
        const parsed = new URL(sourceOrigin);
        if (parsed.origin !== sourceOrigin) {
          return t("workflows.validation.sourceOriginOnly");
        }
      } catch {
        return t("workflows.validation.sourceOriginInvalid");
      }
    }
    if (
      draft.extraction.sourcePath.trim() &&
      (!draft.extraction.sourcePath.trim().startsWith("/") ||
        draft.extraction.sourcePath.includes("?") ||
        draft.extraction.sourcePath.includes("#"))
    ) {
      return t("workflows.validation.sourcePath");
    }
  }
  if (draft.extraction.mode === "prefix" && !draft.extraction.prefix) {
    return t("workflows.validation.prefix");
  }
  if (draft.extraction.mode === "regex") {
    const regexError = scanRegexValidationError(
      draft.extraction.pattern,
      draft.extraction.flags,
    );
    if (regexError || !draft.extraction.group.trim()) {
      return regexError ?? t("workflows.validation.regexGroup");
    }
  }

  const propertyKeys = new Set<string>();
  propertyKeys.add(draft.identifierPropertyKey.trim());
  for (const field of draft.extractedFields) {
    if (!field.key.trim() || !field.label.trim()) {
      return t("workflows.validation.input");
    }
    if (
      !validPropertyKey.test(field.key.trim()) ||
      propertyKeys.has(field.key.trim())
    ) {
      return t("workflows.validation.uniqueKeys");
    }
    propertyKeys.add(field.key.trim());
    if (field.extraction.mode === "regex") {
      const regexError = scanRegexValidationError(
        field.extraction.pattern,
        field.extraction.flags,
      );
      if (regexError || !field.extraction.group.trim()) {
        return regexError ?? t("workflows.validation.regexGroup");
      }
    }
  }
  for (const property of draft.fixedProperties) {
    if (!property.key.trim() || !property.label.trim() || !property.value.trim()) {
      return t("workflows.validation.fixedProperty");
    }
    if (!validPropertyKey.test(property.key.trim())) {
      return t("workflows.validation.propertyKey");
    }
    if (propertyKeys.has(property.key.trim())) {
      return t("workflows.validation.uniqueKeys");
    }
    propertyKeys.add(property.key.trim());
  }

  const inputKeys = new Set<string>();
  for (const field of draft.inputFields) {
    if (!field.key.trim() || !field.label.trim()) {
      return t("workflows.validation.input");
    }
    if (!validPropertyKey.test(field.key.trim())) {
      return t("workflows.validation.propertyKey");
    }
    if (inputKeys.has(field.key.trim()) || propertyKeys.has(field.key.trim())) {
      return t("workflows.validation.uniqueKeys");
    }
    inputKeys.add(field.key.trim());
    if (
      (field.type === "select" || field.type === "radio") &&
      field.options.length === 0
    ) return t("workflows.validation.optionRequired", {
      field: field.label || t("workflows.validation.eachInput"),
    });
    const optionValues = new Set<string>();
    for (const option of field.options) {
      if (!option.value.trim() || !option.label.trim()) {
        return t("workflows.validation.optionValues", {
          field: field.label || t("workflows.validation.anInput"),
        });
      }
      if (optionValues.has(option.value.trim())) {
        return t("workflows.validation.optionUnique", {
          field: field.label || t("workflows.validation.anInput"),
        });
      }
      optionValues.add(option.value.trim());
    }
  }
  if (draft.quantityInputKey) {
    const quantityField = draft.inputFields.find(
      (field) => field.key.trim() === draft.quantityInputKey,
    );
    if (
      draft.operation.type === "unit" ||
      !quantityField ||
      quantityField.type !== "number" ||
      !quantityField.required
    ) {
      return t("workflows.validation.quantityInput");
    }
  }
  if (draft.publicTriggerEnabled && draft.publicTriggerCode.trim()) {
    const publicCode = extractIdentifier(
      draft.publicTriggerCode,
      draft.extraction,
      t,
    );
    if (publicCode.error) return t("workflows.validation.publicTriggerCode");
  }
  if (!draft.webhookEventName.trim()) return t("workflows.validation.input");
  return null;
}

export function extractIdentifier(
  scannedValue: string,
  extraction: WorkflowDraft["extraction"],
  t: TFunction,
): { value: string | null; error: string | null } {
  const raw = scannedValue.trim();
  if (!raw) return { value: null, error: t("workflows.extractionErrors.empty") };

  if (extraction.mode === "full") return { value: raw, error: null };
  if (extraction.mode === "prefix") {
    if (!raw.startsWith(extraction.prefix)) {
      return { value: null, error: t("workflows.extractionErrors.prefixMismatch", { prefix: extraction.prefix }) };
    }
    const value = raw.slice(extraction.prefix.length).trim();
    return value
      ? { value, error: null }
      : { value: null, error: t("workflows.extractionErrors.prefixEmpty") };
  }
  if (extraction.mode === "regex") {
    const extracted = extractScanRegexValue(raw, extraction);
    return extracted.error
      ? { value: null, error: extracted.error }
      : { value: extracted.value, error: null };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { value: null, error: t("workflows.extractionErrors.invalidUrl") };
  }

  if (extraction.sourceOrigin.trim()) {
    try {
      const expectedOrigin = new URL(extraction.sourceOrigin).origin;
      if (url.origin !== expectedOrigin) {
        return { value: null, error: t("workflows.extractionErrors.originMismatch", { origin: expectedOrigin }) };
      }
    } catch {
      return { value: null, error: t("workflows.extractionErrors.originInvalid") };
    }
  }
  if (extraction.sourcePath.trim() && url.pathname !== extraction.sourcePath.trim()) {
    return { value: null, error: t("workflows.extractionErrors.pathMismatch", { path: extraction.sourcePath.trim() }) };
  }
  const parameter = extraction.parameter.trim();
  const values = url.searchParams.getAll(parameter);
  if (values.length !== 1) {
    return {
      value: null,
      error: t("workflows.extractionErrors.queryCount", { parameter: parameter || "?" }),
    };
  }
  const value = values[0].trim();
  return value
    ? { value, error: null }
    : {
      value: null,
      error: t("workflows.extractionErrors.queryEmpty", { parameter: parameter || "?" }),
    };
}

