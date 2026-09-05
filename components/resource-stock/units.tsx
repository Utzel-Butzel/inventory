"use client";

import { formatDate, formatMoney, localDateTime } from "@/lib/client-formatters";

import { OrganizationLink as Link } from "@/components/organization-routing";
import {
  Barcode,
  CalendarDays,
  Copy,
  Info,
  Layers3,
  LoaderCircle,
  MapPin,
  Save,
  Settings2,
  X,
} from "lucide-react";

import {
  CustomFieldInputs,
  CustomFieldValueSummary,
} from "@/components/custom-field-inputs";

import { inputClass, labelClass, SectionHeading } from "./fields";
import { statusLabelKeys, unitStatusClass, unitStatuses } from "./model";
import type { StockSectionProps, UnitStatus } from "./types";

import { StockUnitCreateForm, type StockUnitCreateFormProps } from "./unit-create-form";

export type StockUnitsProps = StockUnitCreateFormProps & Pick<StockSectionProps, "locale" | "numberFormat">;

export function StockUnits({
  stock,
  t,
  locale,
  numberFormat,
  customFieldError,
  availableLocations,
  applicableCustomFields,
  units,
}: StockUnitsProps) {
  const {
    editingUnitId,
    setEditingUnitId,
    unitEditForm,
    setUnitEditForm,
    savingUnit,
    saveUnit,
  } = units;
  return (
    <section
      id="serialized-units"
      className={`${stock.config.trackingMode === "serialized" ? "" : "hidden "}mt-5 scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]`}
    >
      <SectionHeading
        icon={<Barcode className="size-4" aria-hidden="true" />}
        title={t("resource.units.title")}
        description={t("resource.units.description", {
          count: stock.units.length,
          value: numberFormat.format(stock.units.length),
        })}
        trailing={
          <span className="hidden rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-success sm:inline-flex">
            {t("resource.units.availableCount", {
              count: stock.units.filter((unit) => unit.status === "available")
                .length,
              value: numberFormat.format(
                stock.units.filter((unit) => unit.status === "available")
                  .length,
              ),
            })}
          </span>
        }
      />

      {stock.config.trackingMode === "serialized" ? (
        <div className="grid items-start xl:grid-cols-[360px_minmax(0,1fr)]">
          <StockUnitCreateForm
            stock={stock}
            t={t}
            customFieldError={customFieldError}
            availableLocations={availableLocations}
            applicableCustomFields={applicableCustomFields}
            units={units}
          />

          <div className="min-w-0">
            {stock.units.length ? (
              <div className="divide-y divide-border">
                {stock.units.map((unit) => {
                  const editing = editingUnitId === unit.id && unitEditForm;
                  return (
                    <div key={unit.id} className="p-4 sm:p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-subtle text-muted">
                            <Barcode className="size-[18px]" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-mono text-xs font-semibold text-foreground">
                                {unit.code}
                              </p>
                              <span
                                className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-bold uppercase tracking-wide ${unitStatusClass(unit.status)}`}
                              >
                                {t(statusLabelKeys[unit.status], {
                                  defaultValue: unit.status,
                                })}
                              </span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                              <span className="flex items-center gap-1">
                                <MapPin className="size-3" aria-hidden="true" />
                                {unit.location || t("resource.units.noLocation")}
                              </span>
                              <span className="flex items-center gap-1">
                                <CalendarDays className="size-3" aria-hidden="true" />
                                {t("resource.units.acquired", {
                                  date: formatDate(unit.acquiredAt, locale),
                                })}
                              </span>
                              <span>
                                {t("resource.units.moved", {
                                  date: formatDate(unit.lastMovedAt, locale, true),
                                })}
                              </span>
                              {unit.acquisitionCostCents !== null &&
                                unit.acquisitionCostCents !== undefined &&
                                unit.costCurrency ? (
                                <span className="font-semibold text-brand">
                                  {formatMoney(
                                    unit.acquisitionCostCents,
                                    unit.costCurrency,
                                    locale,
                                  )}
                                </span>
                              ) : null}
                            </div>
                            {unit.installation ? (
                              <Link
                                href={`/inventory/${unit.installation.assemblyResourceId}/stock`}
                                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-info-soft px-2.5 py-1.5 text-[11px] font-semibold text-info transition hover:bg-info-soft/80"
                              >
                                <Layers3 className="size-3" aria-hidden="true" />
                                {t("resource.units.installedIn", {
                                  assembly: unit.installation.assemblyName,
                                })}
                                {unit.installation.outputUnitCode
                                  ? ` · ${unit.installation.outputUnitCode}`
                                  : ""}
                              </Link>
                            ) : null}
                            <CustomFieldValueSummary
                              definitions={applicableCustomFields}
                              values={unit.customFields}
                              limit={4}
                              className="mt-2"
                            />
                            {Object.keys(unit.metadata ?? {}).length ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {Object.entries(unit.metadata)
                                  .slice(0, 4)
                                  .map(([key, value]) => (
                                    <span
                                      key={key}
                                      className="rounded-md bg-surface-muted px-2 py-1 text-[10px] text-muted"
                                    >
                                      {key}: {String(value)}
                                    </span>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 pl-[52px] sm:pl-0">
                          <button
                            type="button"
                            onClick={() => {
                              if (editing) {
                                setEditingUnitId(null);
                                setUnitEditForm(null);
                                return;
                              }
                              setEditingUnitId(unit.id);
                              setUnitEditForm({
                                status: unit.status,
                                location: unit.location ?? "",
                                locationResourceId: unit.locationResourceId ?? "",
                                customFields: unit.customFields ?? {},
                                metadata: JSON.stringify(unit.metadata ?? {}, null, 2),
                                occurredAt: localDateTime(),
                                reason: "",
                                note: "",
                                totalPrice: "",
                              });
                            }}
                            className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-hover hover:text-muted-strong"
                            aria-label={t("resource.actions.update")}
                            title={t("resource.actions.update")}
                          >
                            {editing ? (
                              <X className="size-3.5" aria-hidden="true" />
                            ) : (
                              <Settings2 className="size-3.5" aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard.writeText(unit.code)}
                            className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-hover hover:text-muted-strong"
                            aria-label={t("resource.actions.copyUnitIdWithCode", {
                              code: unit.code,
                            })}
                            title={t("resource.actions.copyUnitId")}
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      {editing && unitEditForm ? (
                        <form
                          onSubmit={saveUnit}
                          className="mt-4 rounded-xl border border-brand-border bg-brand-soft p-4"
                        >
                          <div className="mb-3 flex items-start gap-2 rounded-lg bg-surface/80 px-3 py-2 text-[11px] leading-4 text-muted">
                            <Info className="mt-0.5 size-3 shrink-0 text-brand" aria-hidden="true" />
                            {t("resource.units.editHelp")}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <label className={labelClass}>
                              {t("resource.units.statusLabel")}
                              <select
                                value={unitEditForm.status}
                                onChange={(event) =>
                                  setUnitEditForm((current) =>
                                    current
                                      ? { ...current, status: event.target.value as UnitStatus }
                                      : current,
                                  )
                                }
                                className={inputClass}
                              >
                                {unitStatuses.map((status) => (
                                  <option key={status} value={status}>
                                    {t(statusLabelKeys[status])}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className={labelClass}>
                              {t("resource.units.inventoryLocation")}
                              <select
                                value={unitEditForm.locationResourceId}
                                onChange={(event) =>
                                  setUnitEditForm((current) =>
                                    current
                                      ? {
                                        ...current,
                                        locationResourceId: event.target.value,
                                      }
                                      : current,
                                  )
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
                              {t("resource.units.locationNote")}
                              <input
                                value={unitEditForm.location}
                                onChange={(event) =>
                                  setUnitEditForm((current) =>
                                    current ? { ...current, location: event.target.value } : current,
                                  )
                                }
                                className={inputClass}
                              />
                            </label>
                            <label className={labelClass}>
                              {t("resource.units.effectiveDate")}
                              <input
                                type="datetime-local"
                                required
                                value={unitEditForm.occurredAt}
                                onChange={(event) =>
                                  setUnitEditForm((current) =>
                                    current ? { ...current, occurredAt: event.target.value } : current,
                                  )
                                }
                                className={inputClass}
                              />
                            </label>
                            <label className={labelClass}>
                              {t("resource.units.transactionPrice")} {" "}
                              <span className="font-normal text-muted">
                                · {t("resource.optional")}
                              </span>
                              <div className="relative">
                                <input
                                  type="number"
                                  min={
                                    unit.status === "available" &&
                                      unitEditForm.status !== "available"
                                      ? "-20000000"
                                      : "0"
                                  }
                                  max="20000000"
                                  step="0.01"
                                  inputMode="decimal"
                                  value={unitEditForm.totalPrice}
                                  onChange={(event) =>
                                    setUnitEditForm((current) =>
                                      current
                                        ? { ...current, totalPrice: event.target.value }
                                        : current,
                                    )
                                  }
                                  placeholder="0.00"
                                  className={`${inputClass} pr-14 tabular-nums`}
                                />
                                <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[12px] text-muted">
                                  {stock.resource.currency}
                                </span>
                              </div>
                              <span className="mt-1 block text-[10px] font-normal leading-4 text-muted">
                                {t("resource.units.transactionPriceHelp")}
                              </span>
                            </label>
                            <label className={`${labelClass} sm:col-span-2`}>
                              {t("resource.units.reason")} {" "}
                              <span className="font-normal text-muted">
                                · {t("resource.optional")}
                              </span>
                              <input
                                value={unitEditForm.reason}
                                onChange={(event) =>
                                  setUnitEditForm((current) =>
                                    current ? { ...current, reason: event.target.value } : current,
                                  )
                                }
                                placeholder={t("resource.units.reasonPlaceholder")}
                                className={inputClass}
                              />
                            </label>
                            <label className={labelClass}>
                              {t("resource.units.internalNote")}
                              <input
                                value={unitEditForm.note}
                                onChange={(event) =>
                                  setUnitEditForm((current) =>
                                    current ? { ...current, note: event.target.value } : current,
                                  )
                                }
                                className={inputClass}
                              />
                            </label>
                            {applicableCustomFields.length ? (
                              <div className="rounded-xl border border-brand-border bg-surface p-3.5 sm:col-span-2 lg:col-span-3">
                                <div className="mb-3">
                                  <p className="text-xs font-semibold text-foreground">
                                    {t("resource.units.customFields")}
                                  </p>
                                  <p className="mt-0.5 text-[11px] leading-4 text-muted">
                                    {t("resource.units.customFieldsEditHelp")}
                                  </p>
                                </div>
                                <CustomFieldInputs
                                  definitions={applicableCustomFields}
                                  values={unitEditForm.customFields}
                                  onChange={(customFields) =>
                                    setUnitEditForm((current) =>
                                      current ? { ...current, customFields } : current,
                                    )
                                  }
                                  disabled={savingUnit}
                                />
                              </div>
                            ) : null}
                            <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
                              {t("resource.units.advancedMetadata")} {" "}
                              <span className="font-normal text-muted">· JSON</span>
                              <textarea
                                rows={4}
                                value={unitEditForm.metadata}
                                onChange={(event) =>
                                  setUnitEditForm((current) =>
                                    current ? { ...current, metadata: event.target.value } : current,
                                  )
                                }
                                spellCheck={false}
                                className={`${inputClass} h-auto resize-y py-3 font-mono text-[12px] leading-5`}
                              />
                            </label>
                          </div>
                          <div className="mt-4 flex flex-col-reverse gap-2 border-t border-brand-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-[10px] text-muted">
                              {t("resource.units.registeredUpdated", {
                                registered: formatDate(unit.createdAt, locale, true),
                                updated: formatDate(unit.updatedAt, locale, true),
                              })}
                            </p>
                            <button
                              type="submit"
                              disabled={savingUnit}
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-solid px-3.5 text-[12px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-50"
                            >
                              {savingUnit ? (
                                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Save className="size-3.5" aria-hidden="true" />
                              )}
                              {t("resource.actions.saveUnit")}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-6 py-16 text-center">
                <Barcode className="mx-auto size-7 text-muted" aria-hidden="true" />
                <h3 className="mt-4 text-sm font-semibold text-muted-strong">
                  {t("resource.units.emptyTitle")}
                </h3>
                <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted">
                  {t("resource.units.emptyDescription")}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
