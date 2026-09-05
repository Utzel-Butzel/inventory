import { scanCodeTypes } from "@/lib/scan-code-types";
import type { TFunction } from "i18next";
import type {
  DraftExtraction,
  Extraction,
  WorkflowDraft,
  WorkflowPayload,
  WorkflowRecord,
} from "./types";

let nextLocalId = 0;
export function localId(prefix: string) {
  nextLocalId += 1;
  return `${prefix}-${nextLocalId}`;
}

export function templateDraft(t: TFunction, resourceId = ""): WorkflowDraft {
  return {
    id: null,
    name: t("workflows.template.name"),
    description: t("workflows.template.description"),
    enabled: true,
    resourceId,
    resourceIds: resourceId ? [resourceId] : [],
    targetSelectionMode: "all",
    allowVariantSelection: false,
    codeTypes: ["qr_code"],
    publicTriggerEnabled: false,
    publicTriggerId: null,
    publicTriggerCode: "",
    quantityInputKey: null,
    extraction: {
      mode: "url-query",
      parameter: "d",
      prefix: "EPD-",
      sourceOrigin: "https://paperlesspaper.de",
      sourcePath: "/b",
      pattern: "^.*[?&]d=(?<value>[^&]+).*$",
      flags: "",
      group: "value",
    },
    identifierPropertyKey: "epdNumber",
    identifierStorage: "custom-field",
    extractedFields: [],
    operation: { type: "assembly-build", quantity: 1 },
    createMissingUnit: true,
    unitStatus: null,
    fixedProperties: [
      {
        uid: "template-fixed-assembly-status",
        key: "assemblyStatus",
        label: t("workflows.template.assemblyStatus"),
        value: "finished-assembled",
        storage: "metadata",
      },
    ],
    inputFields: [
      {
        uid: "template-input-color",
        key: "color",
        label: t("workflows.template.color"),
        required: true,
        type: "radio",
        storage: "custom-field",
        placeholder: "",
        options: [
          { uid: "template-color-wood", value: "wood", label: t("workflows.template.colors.wood"), color: "#b9875e" },
          { uid: "template-color-black", value: "black", label: t("workflows.template.colors.black"), color: "#202124" },
          { uid: "template-color-white", value: "white", label: t("workflows.template.colors.white"), color: "#f4f2ec" },
          { uid: "template-color-pink", value: "pink", label: t("workflows.template.colors.pink"), color: "#ec8eb0" },
          { uid: "template-color-green", value: "green", label: t("workflows.template.colors.green"), color: "#668c67" },
          { uid: "template-color-oak", value: "oak", label: t("workflows.template.colors.oak"), color: "#c9a56a" },
        ],
      },
    ],
    triggerWebhook: false,
    webhookEventName: "inventory.action.executed",
  };
}

export function extractionToDraft(extraction: Extraction): DraftExtraction {
  return {
    mode: extraction.mode,
    parameter: extraction.mode === "url-query" ? extraction.parameter : "d",
    prefix: extraction.mode === "prefix" ? extraction.prefix : "EPD-",
    sourceOrigin:
      extraction.mode === "url-query" ? extraction.sourceOrigin ?? "" : "",
    sourcePath:
      extraction.mode === "url-query" ? extraction.sourcePath ?? "" : "",
    pattern: extraction.mode === "regex" ? extraction.pattern : "(?<value>.+)",
    flags: extraction.mode === "regex" ? extraction.flags : "",
    group: extraction.mode === "regex" ? extraction.group : "value",
  };
}

export function extractionFromDraft(extraction: DraftExtraction): Extraction {
  if (extraction.mode === "full") return { mode: "full" };
  if (extraction.mode === "prefix") {
    return { mode: "prefix", prefix: extraction.prefix.trim() };
  }
  if (extraction.mode === "regex") {
    return {
      mode: "regex",
      pattern: extraction.pattern,
      flags: extraction.flags,
      group: extraction.group,
    };
  }
  return {
    mode: "url-query",
    parameter: extraction.parameter.trim(),
    ...(extraction.sourceOrigin.trim()
      ? { sourceOrigin: extraction.sourceOrigin.trim() }
      : {}),
    ...(extraction.sourcePath.trim()
      ? { sourcePath: extraction.sourcePath.trim() }
      : {}),
  };
}

export function workflowToDraft(workflow: WorkflowRecord): WorkflowDraft {
  const extraction = workflow.extraction;
  return {
    ...workflow,
    id: workflow.id,
    resourceIds: workflow.resourceIds?.length
      ? workflow.resourceIds
      : [workflow.resourceId],
    targetSelectionMode: workflow.targetSelectionMode ?? "all",
    allowVariantSelection: workflow.allowVariantSelection ?? false,
    extraction: extractionToDraft(extraction),
    codeTypes: workflow.codeTypes?.length
      ? workflow.codeTypes
      : [...scanCodeTypes],
    publicTriggerEnabled: workflow.publicTriggerEnabled ?? false,
    publicTriggerId: workflow.publicTriggerId ?? null,
    publicTriggerCode: workflow.publicTriggerCode ?? "",
    quantityInputKey: workflow.quantityInputKey ?? null,
    identifierStorage: workflow.identifierStorage ?? "metadata",
    operation: workflow.operation ?? { type: "unit" },
    extractedFields: (workflow.extractedFields ?? []).map((field, index) => ({
      ...field,
      uid: `extracted-${index}-${field.key}`,
      storage: field.storage ?? "custom-field",
      extraction: extractionToDraft(field.extraction),
    })),
    fixedProperties: workflow.fixedProperties.map((property, index) => ({
      ...property,
      storage: property.storage ?? "metadata",
      uid: `fixed-${index}-${property.key}`,
    })),
    inputFields: workflow.inputFields.map((field, fieldIndex) => ({
      ...field,
      type: field.type ?? "select",
      storage: field.storage ?? "metadata",
      placeholder: field.placeholder ?? "",
      uid: `input-${fieldIndex}-${field.key}`,
      options: field.options.map((option, optionIndex) => ({
        ...option,
        uid: `option-${fieldIndex}-${optionIndex}-${option.value}`,
      })),
    })),
    triggerWebhook: workflow.triggerWebhook ?? false,
    webhookEventName:
      workflow.webhookEventName ?? "inventory.action.executed",
  };
}

export function draftToPayload(draft: WorkflowDraft): WorkflowPayload {
  const extraction = extractionFromDraft(draft.extraction);

  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    enabled: draft.enabled,
    resourceId: draft.resourceIds[0] ?? draft.resourceId,
    resourceIds: draft.resourceIds,
    targetSelectionMode: draft.targetSelectionMode,
    allowVariantSelection: draft.allowVariantSelection,
    codeTypes: draft.codeTypes,
    publicTriggerEnabled: draft.publicTriggerEnabled,
    publicTriggerCode: draft.publicTriggerCode.trim() || null,
    quantityInputKey: draft.quantityInputKey,
    extraction,
    identifierPropertyKey: draft.identifierPropertyKey.trim(),
    identifierStorage: draft.identifierStorage,
    extractedFields: draft.extractedFields.map((field) => ({
      key: field.key.trim(),
      label: field.label.trim(),
      storage: field.storage,
      extraction: extractionFromDraft(field.extraction),
    })),
    operation: draft.operation,
    createMissingUnit: draft.createMissingUnit,
    unitStatus: draft.unitStatus,
    fixedProperties: draft.fixedProperties.map(({ key, label, value, storage }) => ({
      key: key.trim(),
      label: label.trim(),
      value: value.trim(),
      storage,
    })),
    inputFields: draft.inputFields.map(({ key, label, required, type, storage, placeholder, options }) => ({
      key: key.trim(),
      label: label.trim(),
      required,
      type,
      storage,
      placeholder: placeholder.trim(),
      options: options.map(({ value, label: optionLabel, color }) => ({
        value: value.trim(),
        label: optionLabel.trim(),
        ...(color ? { color } : {}),
      })),
    })),
    triggerWebhook: draft.triggerWebhook,
    webhookEventName: draft.webhookEventName.trim(),
    ...(draft.revision !== undefined ? { revision: draft.revision } : {}),
  };
}

export function payloadSignature(draft: WorkflowDraft) {
  return JSON.stringify(draftToPayload(draft));
}


export function updateDraftExtraction(
  draft: WorkflowDraft,
  patch: Partial<DraftExtraction>,
  fieldUid?: string,
): WorkflowDraft {
  if (fieldUid) {
    return {
      ...draft,
      extractedFields: draft.extractedFields.map((field) =>
        field.uid === fieldUid
          ? { ...field, extraction: { ...field.extraction, ...patch } }
          : field,
      ),
    };
  }
  return { ...draft, extraction: { ...draft.extraction, ...patch } };
}
