"use client";

import { CustomFieldInputs } from "@/components/custom-field-inputs";
import { type CustomFieldDefinition } from "@/lib/custom-field-contract";
import { LoaderCircle, PackageCheck, Plus } from "lucide-react";
import { inputClass, labelClass } from "./fields";
import type { StockLocationOption, StockSectionProps } from "./types";
import type { StockUnitsController } from "./use-stock-units";

export type StockUnitCreateFormProps = Pick<StockSectionProps, "stock" | "t"> & {
  customFieldError: string | null;
  availableLocations: StockLocationOption[];
  applicableCustomFields: CustomFieldDefinition[];
  units: StockUnitsController;
};

export function StockUnitCreateForm({
  stock,
  t,
  customFieldError,
  availableLocations,
  applicableCustomFields,
  units,
}: StockUnitCreateFormProps) {
  const { unitCreateForm, setUnitCreateForm, creatingUnits, createUnits } = units;
  return (
    <form
      onSubmit={createUnits}
      className="border-b border-border bg-surface-subtle p-5 sm:p-6 xl:border-b-0 xl:border-r"
    >
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-xl bg-brand-soft text-brand">
          <PackageCheck className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-xs font-semibold text-foreground">
            {t("resource.units.registerTitle")}
          </h3>
          <p className="text-[11px] text-muted">
            {t("resource.units.registerDescription")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 rounded-xl bg-surface-muted p-1">
        <button
          type="button"
          onClick={() =>
            setUnitCreateForm((current) => ({ ...current, idMode: "generated" }))
          }
          className={`h-9 rounded-lg text-[12px] font-semibold transition ${unitCreateForm.idMode === "generated"
              ? "bg-surface text-brand shadow-sm"
              : "text-muted"
            }`}
        >
          {t("resource.units.generateIds")}
        </button>
        <button
          type="button"
          onClick={() =>
            setUnitCreateForm((current) => ({ ...current, idMode: "custom" }))
          }
          className={`h-9 rounded-lg text-[12px] font-semibold transition ${unitCreateForm.idMode === "custom"
              ? "bg-surface text-brand shadow-sm"
              : "text-muted"
            }`}
        >
          {t("resource.units.customIds")}
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {unitCreateForm.idMode === "generated" ? (
          <label className={labelClass}>
            {t("resource.units.numberOfUnits")}
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              required
              value={unitCreateForm.count}
              onChange={(event) =>
                setUnitCreateForm((current) => ({
                  ...current,
                  count: event.target.value,
                }))
              }
              className={inputClass}
            />
          </label>
        ) : (
          <label className={labelClass}>
            {t("resource.units.unitIds")} {" "}
            <span className="font-normal text-muted">
              · {t("resource.units.onePerLine")}
            </span>
            <textarea
              rows={5}
              required
              value={unitCreateForm.codes}
              onChange={(event) =>
                setUnitCreateForm((current) => ({
                  ...current,
                  codes: event.target.value,
                }))
              }
              placeholder={"TOOL-0042-A\nTOOL-0042-B"}
              className={`${inputClass} h-auto resize-y py-3 font-mono text-xs leading-5`}
            />
          </label>
        )}
        <label className={labelClass}>
          {t("resource.units.inventoryLocation")} {" "}
          <span className="font-normal text-muted">
            · {t("resource.optional")}
          </span>
          <select
            value={unitCreateForm.locationResourceId}
            onChange={(event) =>
              setUnitCreateForm((current) => ({
                ...current,
                locationResourceId: event.target.value,
              }))
            }
            className={inputClass}
          >
            <option value="">{t("resource.units.notAssigned")}</option>
            {availableLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ·{" "}
                {t(`resource.locationTypes.${location.type}`, {
                  defaultValue: location.type,
                })}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {t("resource.units.locationNote")} {" "}
          <span className="font-normal text-muted">
            · {t("resource.optional")}
          </span>
          <input
            value={unitCreateForm.location}
            maxLength={240}
            onChange={(event) =>
              setUnitCreateForm((current) => ({
                ...current,
                location: event.target.value,
              }))
            }
            placeholder={t("resource.units.locationNotePlaceholder")}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          {t("resource.units.acquiredOn")}
          <input
            type="datetime-local"
            value={unitCreateForm.acquiredAt}
            onChange={(event) =>
              setUnitCreateForm((current) => ({
                ...current,
                acquiredAt: event.target.value,
              }))
            }
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          {t("resource.units.acquisitionPrice")} {" "}
          <span className="font-normal text-muted">
            · {t("resource.optional")}
          </span>
          <div className="relative">
            <input
              type="number"
              min="0"
              max="20000000"
              step="0.01"
              inputMode="decimal"
              value={unitCreateForm.totalPrice}
              onChange={(event) =>
                setUnitCreateForm((current) => ({
                  ...current,
                  totalPrice: event.target.value,
                }))
              }
              placeholder="0.00"
              className={`${inputClass} pr-14 tabular-nums`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[12px] text-muted">
              {stock.resource.currency}
            </span>
          </div>
          <span className="mt-1 block text-[10px] font-normal leading-4 text-muted">
            {t("resource.units.acquisitionPriceHelp")}
          </span>
        </label>
        {applicableCustomFields.length ? (
          <div className="rounded-xl border border-brand-border bg-surface p-3.5">
            <div className="mb-3">
              <p className="text-xs font-semibold text-foreground">
                {t("resource.units.customFields")}
              </p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted">
                {t("resource.units.customFieldsBatchHelp")}
              </p>
            </div>
            <CustomFieldInputs
              definitions={applicableCustomFields}
              values={unitCreateForm.customFields}
              onChange={(customFields) =>
                setUnitCreateForm((current) => ({
                  ...current,
                  customFields,
                }))
              }
              disabled={creatingUnits}
              className="sm:grid-cols-1"
            />
          </div>
        ) : customFieldError ? (
          <p className="rounded-xl border border-warning-border bg-warning-soft px-3 py-2 text-[11px] leading-4 text-warning">
            {t("resource.units.customFieldsUnavailable")}
          </p>
        ) : null}
        <label className={labelClass}>
          {t("resource.units.advancedMetadata")} {" "}
          <span className="font-normal text-muted">· JSON</span>
          <textarea
            rows={4}
            value={unitCreateForm.metadata}
            onChange={(event) =>
              setUnitCreateForm((current) => ({
                ...current,
                metadata: event.target.value,
              }))
            }
            spellCheck={false}
            className={`${inputClass} h-auto resize-y py-3 font-mono text-[12px] leading-5`}
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={creatingUnits || Boolean(customFieldError)}
        className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-solid px-4 text-xs font-semibold text-on-brand shadow-sm transition hover:bg-brand-hover disabled:opacity-50"
      >
        {creatingUnits ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="size-4" aria-hidden="true" />
        )}
        {unitCreateForm.idMode === "generated"
          ? t("resource.actions.registerUnits")
          : t("resource.actions.registerCustomIds")}
      </button>
    </form>
  );
}
