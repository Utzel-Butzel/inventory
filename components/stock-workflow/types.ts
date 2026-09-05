import type { InventorySelectItem } from "@/components/inventory-select";
import type { ScanCodeType } from "@/lib/scan-code-types";
import type { TFunction } from "i18next";
import type { Dispatch, SetStateAction } from "react";

export type ExtractionMode = "full" | "url-query" | "prefix" | "regex";
export type UnitStatus =
  | "available"
  | "reserved"
  | "in-use"
  | "maintenance"
  | "consumed"
  | "lost"
  | "retired";

export type Extraction =
  | { mode: "full" }
  | {
    mode: "url-query";
    parameter: string;
    sourceOrigin?: string;
    sourcePath?: string;
  }
  | { mode: "prefix"; prefix: string }
  | { mode: "regex"; pattern: string; flags: string; group: string };

export type StorageTarget = "custom-field" | "metadata" | "execution";
export type TargetSelectionMode = "all" | "radio" | "checkbox";
export type InputType =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "select"
  | "radio"
  | "media"
  | "file";
export type Operation =
  | { type: "unit" }
  | { type: "stock-adjustment"; delta: number }
  | { type: "assembly-build"; quantity: number };

export type FixedProperty = {
  key: string;
  label: string;
  value: string;
  storage: StorageTarget;
};

export type ExtractedField = {
  key: string;
  label: string;
  extraction: Extraction;
  storage: StorageTarget;
};

export type InputOption = {
  value: string;
  label: string;
  color?: string;
};

export type InputField = {
  key: string;
  label: string;
  required: boolean;
  type: InputType;
  storage: StorageTarget;
  placeholder: string;
  options: InputOption[];
};

export type WorkflowPayload = {
  name: string;
  description: string;
  enabled: boolean;
  resourceId: string;
  resourceIds: string[];
  targetSelectionMode: TargetSelectionMode;
  allowVariantSelection: boolean;
  codeTypes: ScanCodeType[];
  publicTriggerEnabled: boolean;
  publicTriggerCode: string | null;
  quantityInputKey: string | null;
  extraction: Extraction;
  identifierPropertyKey: string;
  identifierStorage: StorageTarget;
  extractedFields: ExtractedField[];
  operation: Operation;
  createMissingUnit: boolean;
  unitStatus: UnitStatus | null;
  fixedProperties: FixedProperty[];
  inputFields: InputField[];
  triggerWebhook: boolean;
  webhookEventName: string;
  revision?: number;
};

export type WorkflowRecord = Omit<WorkflowPayload, "revision"> & {
  id: string;
  publicTriggerId: string;
  revision: number;
  createdAt?: string;
  updatedAt?: string;
};

export type StockItem = {
  resourceId: string;
  name: string;
  sku?: string | null;
  type?: string;
  quantity?: number;
  trackingMode: string;
  unitName?: string;
  variantOfResourceId?: string | null;
  cover?: InventorySelectItem["cover"];
};

export type StockUnitCustomField = {
  key: string;
  label: string;
  fieldType: string;
};

export type DraftOption = InputOption & { uid: string };
export type DraftInput = Omit<InputField, "options"> & {
  uid: string;
  options: DraftOption[];
};
export type DraftFixedProperty = FixedProperty & { uid: string };
export type DraftExtraction = {
  mode: ExtractionMode;
  parameter: string;
  prefix: string;
  sourceOrigin: string;
  sourcePath: string;
  pattern: string;
  flags: string;
  group: string;
};
export type DraftExtractedField = Omit<ExtractedField, "extraction"> & {
  uid: string;
  extraction: DraftExtraction;
};

export type WorkflowDraft = Omit<
  WorkflowPayload,
  "publicTriggerCode" | "extraction" | "extractedFields" | "fixedProperties" | "inputFields"
> & {
  id: string | null;
  publicTriggerId: string | null;
  publicTriggerCode: string;
  extraction: DraftExtraction;
  extractedFields: DraftExtractedField[];
  fixedProperties: DraftFixedProperty[];
  inputFields: DraftInput[];
};

export type Notice = { tone: "success" | "error" | "info"; message: string };

export type WorkflowStepProps = {
  draft: WorkflowDraft;
  setDraft: Dispatch<SetStateAction<WorkflowDraft>>;
  editable: boolean;
  t: TFunction;
  integer: Intl.NumberFormat;
};
