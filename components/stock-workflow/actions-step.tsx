"use client";

import { Plus, Settings2, Trash2, Webhook } from "lucide-react";

import { Button, cn } from "@/components/ui";

import { localId } from "./draft";
import {
  FlowStep,
  StockUnitCustomFieldSelect,
  StorageTargetSelect,
  Toggle,
  inputClass,
  labelClass,
  visiblePropertyValue,
} from "./fields";
import type {
  DraftFixedProperty,
  Operation,
  StockUnitCustomField,
  UnitStatus,
  WorkflowStepProps,
} from "./types";

type WorkflowActionsStepProps = WorkflowStepProps & {
  canManage: boolean;
  stockUnitCustomFields: StockUnitCustomField[];
};

const unitStatuses: UnitStatus[] = [
  "available",
  "reserved",
  "in-use",
  "maintenance",
  "consumed",
  "lost",
  "retired",
];

export function WorkflowActionsStep({
  draft,
  setDraft,
  editable,
  canManage,
  t,
  integer,
  stockUnitCustomFields,
}: WorkflowActionsStepProps) {
  const updateFixedProperty = (
    uid: string,
    key: keyof Pick<DraftFixedProperty, "key" | "label" | "value" | "storage">,
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      fixedProperties: current.fixedProperties.map((property) =>
        property.uid === uid ? { ...property, [key]: value } : property,
      ),
    }));
  };

  return (
    <FlowStep
      number={integer.format(5)}
      icon={<Settings2 className="size-[18px] sm:size-5" aria-hidden="true" />}
      title={t("workflows.steps.actions.title")}
      description={t("workflows.steps.actions.description")}
      last
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Hauptaktion
          <select
            value={draft.operation.type}
            onChange={(event) => {
              const type = event.target.value as Operation["type"];
              setDraft((current) => ({
                ...current,
                quantityInputKey:
                  type === "unit" ? null : current.quantityInputKey,
                ...(type === "stock-adjustment"
                  ? {
                    identifierStorage: "execution" as const,
                    extractedFields: current.extractedFields.map((field) => ({
                      ...field,
                      storage: "execution" as const,
                    })),
                    fixedProperties: current.fixedProperties.map((property) => ({
                      ...property,
                      storage: "execution" as const,
                    })),
                    inputFields: current.inputFields.map((field) => ({
                      ...field,
                      storage: "execution" as const,
                    })),
                  }
                  : {}),
                operation:
                  type === "stock-adjustment"
                    ? { type, delta: 5 }
                    : type === "assembly-build"
                      ? { type, quantity: 1 }
                      : { type: "unit" },
              }));
            }}
            className={inputClass}
            disabled={!editable}
          >
            <option value="assembly-build">Baugruppe fertigstellen</option>
            <option value="stock-adjustment">Bestand ein-/ausbuchen</option>
            <option value="unit">Einheit anlegen/aktualisieren</option>
          </select>
        </label>
        {draft.operation.type === "stock-adjustment" ? (
          <label className={labelClass}>
            Bestandsänderung
            <input
              type="number"
              value={draft.operation.delta}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  operation: {
                    type: "stock-adjustment",
                    delta: Number(event.target.value),
                  },
                }))
              }
              className={inputClass}
              disabled={!editable}
            />
            <span className="mt-1 block text-[11px] text-muted">
              Positiv zum Einbuchen, negativ zum Ausbuchen – z. B. +5.
            </span>
          </label>
        ) : draft.operation.type === "assembly-build" ? (
          <label className={labelClass}>
            Fertige Menge
            <input
              type="number"
              min={1}
              max={1000}
              value={draft.operation.quantity}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  operation: {
                    type: "assembly-build",
                    quantity: Number(event.target.value),
                  },
                }))
              }
              className={inputClass}
              disabled={!editable}
            />
            <span className="mt-1 block text-[11px] text-muted">
              Die Stückliste wird automatisch verbraucht.
            </span>
          </label>
        ) : null}
      </div>

      {draft.operation.type !== "unit" ? (
        <div className="mt-3 rounded-xl border border-border bg-surface-subtle p-3.5">
          <label className={labelClass}>
            {t("workflows.quantityInput.label")}
            <select
              value={draft.quantityInputKey ?? ""}
              onChange={(event) => {
                const quantityInputKey = event.target.value || null;
                setDraft((current) => ({
                  ...current,
                  quantityInputKey,
                  inputFields: current.inputFields.map((field) =>
                    field.key === quantityInputKey
                      ? { ...field, required: true }
                      : field,
                  ),
                }));
              }}
              className={inputClass}
              disabled={!editable}
            >
              <option value="">{t("workflows.quantityInput.fixed")}</option>
              {draft.inputFields
                .filter((field) => field.type === "number")
                .map((field) => (
                  <option key={field.uid} value={field.key}>
                    {field.label || field.key}
                  </option>
                ))}
            </select>
          </label>
          <p className="mt-1.5 text-[11px] leading-4 text-muted">
            {draft.inputFields.some((field) => field.type === "number")
              ? t("workflows.quantityInput.description")
              : t("workflows.quantityInput.noNumberField")}
          </p>
        </div>
      ) : null}

      {draft.operation.type === "unit" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-muted-strong">{t("workflows.steps.actions.createMissing")}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted">{t("workflows.steps.actions.createMissingDescription")}</p>
              </div>
              <Toggle
                checked={draft.createMissingUnit}
                onChange={(createMissingUnit) => setDraft((current) => ({ ...current, createMissingUnit }))}
                disabled={!editable}
                label={t("workflows.steps.actions.createMissingAria")}
              />
            </div>
          </div>
          <label className={labelClass}>
            {t("workflows.steps.actions.status")}
            <select
              value={draft.unitStatus ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  unitStatus: (event.target.value || null) as UnitStatus | null,
                }))
              }
              className={inputClass}
              disabled={!editable}
            >
              <option value="">{t("workflows.steps.actions.keepStatus")}</option>
              {unitStatuses.map((status) => (
                <option key={status} value={status}>{t(`statuses.${status}`)}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-muted-strong">{t("workflows.steps.actions.fixedTitle")}</p>
            <p className="mt-0.5 text-[11px] text-muted">{t("workflows.steps.actions.fixedDescription")}</p>
          </div>
          {canManage ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  fixedProperties: [
                    ...current.fixedProperties,
                    {
                      uid: localId("fixed"),
                      key: `property${current.fixedProperties.length + 1}`,
                      label: t("workflows.steps.actions.newProperty", {
                        value: integer.format(current.fixedProperties.length + 1),
                      }),
                      value: t("workflows.steps.actions.defaultValue"),
                      storage: "metadata",
                    },
                  ],
                }))
              }
              disabled={!editable}
            >
              <Plus className="size-3.5" aria-hidden="true" /> {t("workflows.steps.actions.addProperty")}
            </Button>
          ) : null}
        </div>

        <div className="space-y-2">
          {draft.fixedProperties.map((property) => (
            <div key={property.uid} className="rounded-xl border border-border bg-surface-subtle p-3">
              <div className="grid gap-2 sm:grid-cols-4">
                {property.storage === "custom-field" ? (
                  <StockUnitCustomFieldSelect
                    fields={stockUnitCustomFields}
                    value={property.key}
                    onChange={(value) =>
                      updateFixedProperty(property.uid, "key", value)
                    }
                    disabled={!editable}
                    t={t}
                  />
                ) : (
                  <label className={labelClass}>
                    {t("workflows.storage.propertyKey")}
                    <input
                      value={property.key}
                      onChange={(event) =>
                        updateFixedProperty(
                          property.uid,
                          "key",
                          event.target.value,
                        )
                      }
                      className={inputClass}
                      placeholder={t("workflows.steps.actions.keyPlaceholder")}
                      disabled={!editable}
                    />
                  </label>
                )}
                <label className={labelClass}>
                  {t("workflows.steps.actions.visibleLabel")}
                  <input
                    value={property.label}
                    onChange={(event) => updateFixedProperty(property.uid, "label", event.target.value)}
                    className={inputClass}
                    placeholder={t("workflows.template.assemblyStatus")}
                    disabled={!editable}
                  />
                </label>
                <label className={labelClass}>
                  {t("workflows.steps.actions.storedValue")}
                  <input
                    value={property.value}
                    onChange={(event) => updateFixedProperty(property.uid, "value", event.target.value)}
                    className={inputClass}
                    placeholder={t("workflows.steps.actions.storedValuePlaceholder")}
                    disabled={!editable}
                  />
                </label>
                <StorageTargetSelect
                  value={property.storage}
                  onChange={(storage) => updateFixedProperty(property.uid, "storage", storage)}
                  disabled={!editable}
                  t={t}
                  compact
                />
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted">
                  {t("workflows.steps.actions.visibleAs", {
                    value: visiblePropertyValue(property, t),
                  })}
                </p>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        fixedProperties: current.fixedProperties.filter((item) => item.uid !== property.uid),
                      }))
                    }
                    disabled={!editable}
                    className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="size-3" aria-hidden="true" /> {t("workflows.steps.actions.remove")}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {draft.fixedProperties.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[12px] text-muted">{t("workflows.steps.actions.none")}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-surface-subtle p-3.5 sm:flex-row sm:items-center">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <Webhook className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-muted-strong">
            Webhook nach erfolgreicher Ausführung
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            Sendet ein signiertes Ereignis an abonnierte Integrations-Webhooks.
          </p>
        </div>
        <input
          aria-label="Webhook-Ereignisname"
          value={draft.webhookEventName}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              webhookEventName: event.target.value,
            }))
          }
          className={cn(inputClass, "mt-0 sm:w-64")}
          disabled={!editable || !draft.triggerWebhook}
        />
        <Toggle
          checked={draft.triggerWebhook}
          onChange={(triggerWebhook) =>
            setDraft((current) => ({ ...current, triggerWebhook }))
          }
          disabled={!editable}
          label="Webhook auslösen"
        />
      </div>
    </FlowStep>
  );
}
