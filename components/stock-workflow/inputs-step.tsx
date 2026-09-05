"use client";

import { Layers3, Plus, Trash2, X } from "lucide-react";

import { Button, cn } from "@/components/ui";

import { localId } from "./draft";
import {
  FlowStep,
  StockUnitCustomFieldSelect,
  StorageTargetSelect,
  inputClass,
  labelClass,
} from "./fields";
import type {
  DraftInput,
  DraftOption,
  InputType,
  StockUnitCustomField,
  WorkflowStepProps,
} from "./types";

type WorkflowInputsStepProps = WorkflowStepProps & {
  canManage: boolean;
  stockUnitCustomFields: StockUnitCustomField[];
};

export function WorkflowInputsStep({
  draft,
  setDraft,
  editable,
  canManage,
  t,
  integer,
  stockUnitCustomFields,
}: WorkflowInputsStepProps) {
  const updateInput = (
    uid: string,
    patch: Partial<
      Pick<DraftInput, "key" | "label" | "required" | "type" | "storage" | "placeholder">
    >,
  ) => {
    setDraft((current) => {
      const previous = current.inputFields.find((field) => field.uid === uid);
      const nextQuantityKey =
        previous && current.quantityInputKey === previous.key
          ? patch.type && patch.type !== "number"
            ? null
            : patch.key ?? current.quantityInputKey
          : current.quantityInputKey;
      return {
        ...current,
        quantityInputKey: nextQuantityKey,
        inputFields: current.inputFields.map((field) =>
          field.uid === uid ? { ...field, ...patch } : field,
        ),
      };
    });
  };

  const updateOption = (
    fieldUid: string,
    optionUid: string,
    key: keyof Pick<DraftOption, "value" | "label" | "color">,
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      inputFields: current.inputFields.map((field) =>
        field.uid === fieldUid
          ? {
            ...field,
            options: field.options.map((option) =>
              option.uid === optionUid ? { ...option, [key]: value } : option,
            ),
          }
          : field,
      ),
    }));
  };

  return (
    <FlowStep
      number={integer.format(4)}
      icon={<Layers3 className="size-[18px] sm:size-5" aria-hidden="true" />}
      title={t("workflows.steps.inputs.title")}
      description={t("workflows.steps.inputs.description")}
    >
      <div className="space-y-3">
        {draft.inputFields.map((field, fieldIndex) => (
          <div key={field.uid} className="rounded-xl border border-border bg-surface-subtle p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md bg-brand-soft text-[11px] font-bold text-brand">
                  {integer.format(fieldIndex + 1)}
                </span>
                <p className="text-[13px] font-semibold text-muted-strong">{t("workflows.steps.inputs.selectField")}</p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      quantityInputKey:
                        current.quantityInputKey === field.key
                          ? null
                          : current.quantityInputKey,
                      inputFields: current.inputFields.filter((item) => item.uid !== field.uid),
                    }))
                  }
                  disabled={!editable}
                  className="grid size-7 place-items-center rounded-lg text-danger transition hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t("workflows.steps.inputs.removeField", {
                    field: field.label || t("workflows.steps.inputs.scanInput"),
                  })}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {field.storage === "custom-field" ? (
                <StockUnitCustomFieldSelect
                  fields={stockUnitCustomFields}
                  value={field.key}
                  onChange={(value) => updateInput(field.uid, { key: value })}
                  disabled={!editable}
                  t={t}
                />
              ) : (
                <label className={labelClass}>
                  {t("workflows.storage.propertyKey")}
                  <input
                    value={field.key}
                    onChange={(event) =>
                      updateInput(field.uid, { key: event.target.value })
                    }
                    className={inputClass}
                    placeholder={t("workflows.steps.inputs.propertyKeyPlaceholder")}
                    disabled={!editable}
                  />
                </label>
              )}
              <label className={labelClass}>
                {t("workflows.steps.inputs.visibleLabel")}
                <input
                  value={field.label}
                  onChange={(event) => updateInput(field.uid, { label: event.target.value })}
                  className={inputClass}
                  placeholder={t("workflows.steps.inputs.visibleLabel")}
                  disabled={!editable}
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className={labelClass}>
                Eingabetyp
                <select
                  value={field.type}
                  onChange={(event) => {
                    const type = event.target.value as InputType;
                    updateInput(field.uid, {
                      type,
                      ...(type === "media" || type === "file"
                        ? { storage: "execution" }
                        : {}),
                    });
                  }}
                  className={inputClass}
                  disabled={!editable}
                >
                  <option value="text">Text</option>
                  <option value="textarea">Mehrzeiliger Text</option>
                  <option value="number">Zahl</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="select">Select</option>
                  <option value="radio">Radio</option>
                  <option value="media">Foto / Video</option>
                  <option value="file">Datei / PDF</option>
                </select>
              </label>
              <StorageTargetSelect
                value={field.storage}
                onChange={(storage) => updateInput(field.uid, { storage })}
                disabled={!editable || field.type === "media" || field.type === "file"}
                t={t}
                compact
              />
              <label className={labelClass}>
                Platzhalter
                <input
                  value={field.placeholder}
                  onChange={(event) =>
                    updateInput(field.uid, { placeholder: event.target.value })
                  }
                  className={inputClass}
                  disabled={!editable}
                />
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[12px] font-medium text-muted-strong">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) => updateInput(field.uid, { required: event.target.checked })}
                disabled={!editable}
                className="size-4 rounded border-border-strong accent-brand-solid disabled:cursor-not-allowed"
              />
              {t("workflows.steps.inputs.required")}
            </label>

            {field.type === "select" || field.type === "radio" ? (
              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">{t("workflows.steps.inputs.options")}</p>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          inputFields: current.inputFields.map((item) =>
                            item.uid === field.uid
                              ? {
                                ...item,
                                options: [
                                  ...item.options,
                                  {
                                    uid: localId("option"),
                                    value: `option-${item.options.length + 1}`,
                                    label: t("workflows.steps.inputs.newOption", {
                                      value: integer.format(item.options.length + 1),
                                    }),
                                    color: "#8b83df",
                                  },
                                ],
                              }
                              : item,
                          ),
                        }))
                      }
                      disabled={!editable}
                      className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-brand transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="size-3" aria-hidden="true" /> {t("workflows.steps.inputs.addOption")}
                    </button>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {field.options.map((option) => (
                    <div key={option.uid} className="grid grid-cols-[36px_minmax(0,1fr)] gap-2 sm:grid-cols-[36px_minmax(0,1fr)_minmax(0,1fr)_30px]">
                      <label className="relative mt-1.5 grid size-9 cursor-pointer place-items-center overflow-hidden rounded-lg border border-border bg-surface shadow-sm" title={t("workflows.steps.inputs.chooseColor")}>
                        <span className="size-5 rounded-full border border-border-strong" style={{ backgroundColor: option.color ?? "#8b83df" }} />
                        <input
                          type="color"
                          value={option.color ?? "#8b83df"}
                          onChange={(event) => updateOption(field.uid, option.uid, "color", event.target.value)}
                          disabled={!editable}
                          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                          aria-label={t("workflows.steps.inputs.colorFor", { label: option.label })}
                        />
                      </label>
                      <label className={labelClass}>
                        <span className="sm:sr-only">{t("workflows.steps.inputs.label")}</span>
                        <input
                          value={option.label}
                          onChange={(event) => updateOption(field.uid, option.uid, "label", event.target.value)}
                          className={cn(inputClass, "mt-1.5")}
                          placeholder={t("workflows.steps.inputs.visibleLabel")}
                          disabled={!editable}
                        />
                      </label>
                      <label className={cn(labelClass, "col-start-2 sm:col-start-auto")}>
                        <span className="sm:sr-only">{t("workflows.steps.inputs.storedValue")}</span>
                        <input
                          value={option.value}
                          onChange={(event) => updateOption(field.uid, option.uid, "value", event.target.value)}
                          className={cn(inputClass, "mt-0 sm:mt-1.5")}
                          placeholder={t("workflows.steps.inputs.storedValue")}
                          disabled={!editable}
                        />
                      </label>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              inputFields: current.inputFields.map((item) =>
                                item.uid === field.uid
                                  ? { ...item, options: item.options.filter((value) => value.uid !== option.uid) }
                                  : item,
                              ),
                            }))
                          }
                          disabled={!editable}
                          className="col-start-1 row-start-2 grid size-7 place-items-center self-center rounded-lg text-danger transition hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50 sm:col-start-auto sm:row-start-auto"
                          aria-label={t("workflows.steps.inputs.removeOption", { label: option.label })}
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {draft.inputFields.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted">
            {t("workflows.steps.inputs.none")}
          </div>
        ) : null}

        {canManage ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                inputFields: [
                  ...current.inputFields,
                  {
                    uid: localId("input"),
                    key: `property${current.inputFields.length + 1}`,
                    label: t("workflows.steps.inputs.newProperty", {
                      value: integer.format(current.inputFields.length + 1),
                    }),
                    required: false,
                    type: "text",
                    storage: "custom-field",
                    placeholder: "",
                    options: [
                      {
                        uid: localId("option"),
                        value: "option-1",
                        label: t("workflows.steps.inputs.newOption", {
                          value: integer.format(1),
                        }),
                        color: "#8b83df",
                      },
                    ],
                  },
                ],
              }))
            }
            disabled={!editable}
          >
            <Plus className="size-3.5" aria-hidden="true" /> {t("workflows.steps.inputs.addField")}
          </Button>
        ) : null}
      </div>
    </FlowStep>
  );
}
