"use client";

import { Plus, Settings2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui";

import { ChainActionsEditor } from "./chain-actions";
import { localId } from "./draft";
import {
  FlowStep,
  StockUnitCustomFieldSelect,
  StorageTargetSelect,
  inputClass,
  labelClass,
  visiblePropertyValue,
} from "./fields";
import type {
  DraftFixedProperty,
  StockUnitCustomField,
  WorkflowStepProps,
  StockItem,
} from "./types";

type WorkflowActionsStepProps = WorkflowStepProps & {
  resources: StockItem[];
  canManage: boolean;
  stockUnitCustomFields: StockUnitCustomField[];
};

export function WorkflowActionsStep({
  draft,
  setDraft,
  editable,
  canManage,
  t,
  integer,
  stockUnitCustomFields,
  resources,
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
      <ChainActionsEditor draft={draft} setDraft={setDraft} editable={editable} resources={resources} />

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
    </FlowStep>
  );
}
