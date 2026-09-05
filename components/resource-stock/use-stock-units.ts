"use client";

import { moneyToCents, toIsoDateTime as toIso } from "@/lib/client-formatters";

import { useState, type FormEvent } from "react";

import { fetchJson } from "@/lib/client-types";

import {
  customFieldValuesEqual,
  defaultUnitCreateForm,
  parseMetadata,
  statusLabelKeys,
} from "./model";
import type { StockMutationContext, UnitCreateForm, UnitEditForm } from "./types";

export function useStockUnits({
  stock,
  endpoint,
  loadStock,
  setError,
  setNotice,
  unitName,
  numberFormat,
  t,
}: StockMutationContext) {
  const [unitCreateForm, setUnitCreateForm] = useState<UnitCreateForm>(
    defaultUnitCreateForm,
  );
  const [creatingUnits, setCreatingUnits] = useState(false);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitEditForm, setUnitEditForm] = useState<UnitEditForm | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);
  async function createUnits(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    try {
      const metadata = parseMetadata(unitCreateForm.metadata, t);
      const acquiredAt = toIso(unitCreateForm.acquiredAt);
      if (unitCreateForm.acquiredAt && !acquiredAt) {
        throw new Error(t("resource.errors.validAcquisitionDate"));
      }
      const totalPriceCents = moneyToCents(unitCreateForm.totalPrice);
      if (Number.isNaN(totalPriceCents)) {
        throw new Error(t("resource.errors.validPrice"));
      }

      let identifierPayload: { count: number } | { code: string } | { codes: string[] };
      let createdCount: number;
      if (unitCreateForm.idMode === "generated") {
        const count = Number(unitCreateForm.count);
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          throw new Error(t("resource.errors.generatedUnitRange"));
        }
        identifierPayload = { count };
        createdCount = count;
      } else {
        const codes = unitCreateForm.codes
          .split(/[\n,]+/)
          .map((code) => code.trim())
          .filter(Boolean);
        if (!codes.length || codes.length > 100) {
          throw new Error(t("resource.errors.customUnitRange"));
        }
        if (new Set(codes.map((code) => code.toLowerCase())).size !== codes.length) {
          throw new Error(t("resource.errors.uniqueUnitIds"));
        }
        if (codes.some((code) => code.length > 120)) {
          throw new Error(t("resource.errors.unitIdLength"));
        }
        identifierPayload = codes.length === 1 ? { code: codes[0]! } : { codes };
        createdCount = codes.length;
      }

      setCreatingUnits(true);
      await fetchJson(`${endpoint}/units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...identifierPayload,
          location: unitCreateForm.location.trim() || undefined,
          locationResourceId: unitCreateForm.locationResourceId || null,
          customFields: unitCreateForm.customFields,
          metadata,
          acquiredAt,
          ...(totalPriceCents === null
            ? {}
            : { totalPriceCents, priceCurrency: stock?.resource.currency ?? "EUR" }),
        }),
      });
      setUnitCreateForm(defaultUnitCreateForm());
      await loadStock(true);
      setNotice(
        t("resource.notices.unitsCreated", {
          count: createdCount,
          value: numberFormat.format(createdCount),
        }),
      );
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t("resource.errors.createUnits"),
      );
    } finally {
      setCreatingUnits(false);
    }
  }

  async function saveUnit(event: FormEvent) {
    event.preventDefault();
    if (!editingUnitId || !unitEditForm || !stock) return;
    setError(null);
    setNotice(null);
    try {
      const metadata = parseMetadata(unitEditForm.metadata, t);
      const occurredAt = toIso(unitEditForm.occurredAt);
      if (unitEditForm.occurredAt && !occurredAt) {
        throw new Error(t("resource.errors.validMovementDate"));
      }
      const unit = stock.units.find((candidate) => candidate.id === editingUnitId);
      const leavingAvailable =
        unit?.status === "available" && unitEditForm.status !== "available";
      const totalPriceCents = moneyToCents(
        unitEditForm.totalPrice,
        leavingAvailable,
      );
      if (Number.isNaN(totalPriceCents)) {
        throw new Error(t("resource.errors.validPrice"));
      }
      const customFieldsChanged = unit
        ? !customFieldValuesEqual(unit.customFields, unitEditForm.customFields)
        : true;
      if (
        leavingAvailable &&
        !window.confirm(
          t("resource.confirm.leaveAvailable", {
            code: unit.code,
            status: t(statusLabelKeys[unitEditForm.status]),
            unit: unitName,
          }),
        )
      ) {
        return;
      }

      setSavingUnit(true);
      await fetchJson(`${endpoint}/units/${editingUnitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: unitEditForm.status,
          location: unitEditForm.location.trim() || null,
          locationResourceId: unitEditForm.locationResourceId || null,
          ...(customFieldsChanged
            ? { customFields: unitEditForm.customFields }
            : {}),
          metadata,
          occurredAt,
          reason: unitEditForm.reason.trim() || undefined,
          note: unitEditForm.note.trim() || undefined,
          ...(totalPriceCents === null
            ? {}
            : { totalPriceCents, priceCurrency: stock.resource.currency }),
        }),
      });
      setEditingUnitId(null);
      setUnitEditForm(null);
      await loadStock(true);
      setNotice(
        t("resource.notices.unitUpdated", {
          code: unit?.code ?? t("resource.units.record"),
        }),
      );
    } catch (unitError) {
      setError(
        unitError instanceof Error
          ? unitError.message
          : t("resource.errors.updateUnit"),
      );
    } finally {
      setSavingUnit(false);
    }
  }

  return {
    unitCreateForm,
    setUnitCreateForm,
    creatingUnits,
    editingUnitId,
    setEditingUnitId,
    unitEditForm,
    setUnitEditForm,
    savingUnit,
    createUnits,
    saveUnit,
  };
}

export type StockUnitsController = ReturnType<typeof useStockUnits>;
