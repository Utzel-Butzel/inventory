"use client";

import { localDateTime } from "@/lib/client-formatters";

import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";

import { type PhotoCountResult } from "@/components/photo-count-capture";
import { fetchJson } from "@/lib/client-types";
import { hasPurchaseUnit } from "@/lib/stock-quantity-units";

import {
  defaultMovementForm,
  incomingTypes,
  outgoingTypes,
  quantityLabel,
} from "./model";
import type {
  MovementForm,
  MovementPayload,
  MovementType,
  StockMovement,
  StockMutationContext,
} from "./types";

import { buildStockMovementPayload } from "./movement-form";

type StockMovementsOptions = StockMutationContext & {
  allowNegativeStock: boolean;
  movementForm: MovementForm;
  setMovementForm: Dispatch<SetStateAction<MovementForm>>;
};

export function useStockMovements({
  stock,
  endpoint,
  loadStock,
  setError,
  setNotice,
  unitName,
  numberFormat,
  t,
  allowNegativeStock,
  movementForm,
  setMovementForm,
}: StockMovementsOptions) {
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [pendingMovement, setPendingMovement] = useState<MovementPayload | null>(null);
  const [postingMovement, setPostingMovement] = useState(false);
  const [editingMovementId, setEditingMovementId] = useState<string | null>(
    null,
  );
  const [movementEditDirection, setMovementEditDirection] = useState<
    "in" | "out"
  >("in");
  const [movementEditForm, setMovementEditForm] = useState<MovementForm | null>(
    null,
  );
  const [savingMovementId, setSavingMovementId] = useState<string | null>(null);
  const [deletingMovementId, setDeletingMovementId] = useState<string | null>(
    null,
  );
  const [historyFilter, setHistoryFilter] = useState<"all" | "in" | "out" | "audit">(
    "all",
  );
  const currentQuantity = stock?.resource.quantity ?? 0;
  const payloadOptions = {
    currentQuantity,
    allowNegativeStock,
    currency: stock?.resource.currency ?? "EUR",
    unitName,
    numberFormat,
    t,
  };
  const purchaseUnit =
    stock && hasPurchaseUnit(stock.config)
      ? {
        name: stock.config.purchaseUnitName,
        factor: stock.config.purchaseUnitFactor,
      }
      : null;
  const purchaseUnitConfigured = purchaseUnit !== null;
  const enteredUnitName =
    direction === "in" &&
      movementForm.quantityUnit === "purchase" &&
      purchaseUnitConfigured
      ? purchaseUnit?.name ?? unitName
      : unitName;
  const enteredUnitFactor =
    direction === "in" &&
      movementForm.quantityUnit === "purchase" &&
      purchaseUnitConfigured
      ? purchaseUnit?.factor ?? 1
      : 1;
  const movementTypes = direction === "in" ? incomingTypes : outgoingTypes;
  const filteredMovements = useMemo(() => {
    const movements = stock?.movements ?? [];
    return movements.filter((movement) => {
      if (historyFilter === "in") return movement.delta > 0;
      if (historyFilter === "out") return movement.delta < 0;
      if (historyFilter === "audit") return movement.delta === 0;
      return true;
    });
  }, [historyFilter, stock?.movements]);

  function selectDirection(next: "in" | "out") {
    setDirection(next);
    setMovementForm((current) => ({
      ...current,
      type: next === "in" ? "receipt" : "issue",
      quantityUnit:
        next === "in" && stock && hasPurchaseUnit(stock.config)
          ? "purchase"
          : "base",
    }));
  }

  function updateMovement<K extends keyof MovementForm>(key: K, value: MovementForm[K]) {
    setMovementForm((current) => ({ ...current, [key]: value }));
  }

  function applyPhotoCount(result: PhotoCountResult) {
    setMovementForm((current) => ({
      ...current,
      quantity: String(result.count),
      quantityUnit: "base",
      reason: current.reason || t("resource.movements.photoAssisted"),
    }));
  }

  function buildMovementPayload() {
    return buildStockMovementPayload(movementForm, {
      ...payloadOptions,
      mode: "create",
      direction,
      purchaseUnitFactor: enteredUnitFactor,
    });
  }

  async function postMovement(payload: MovementPayload) {
    setPostingMovement(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`${endpoint}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setPendingMovement(null);
      setMovementForm(defaultMovementForm(direction));
      await loadStock(true);
      setNotice(
        payload.delta > 0
          ? t("resource.notices.bookedIn", {
            quantity: quantityLabel(payload.delta, unitName, numberFormat, t),
          })
          : t("resource.notices.bookedOut", {
            quantity: quantityLabel(
              Math.abs(payload.delta),
              unitName,
              numberFormat,
              t,
            ),
          }),
      );
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : t("resource.errors.bookMovement"),
      );
    } finally {
      setPostingMovement(false);
    }
  }

  function submitMovement(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!stock) return;
    if (stock.config.trackingMode === "serialized") {
      setError(
        t("resource.errors.serializedBooking"),
      );
      return;
    }
    try {
      const payload = buildMovementPayload();
      if (payload.delta < 0) {
        setPendingMovement(payload);
      } else {
        void postMovement(payload);
      }
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : t("resource.errors.checkBooking"),
      );
    }
  }

  function startEditingMovement(movement: StockMovement) {
    const nextDirection = movement.delta >= 0 ? "in" : "out";
    setEditingMovementId(movement.id);
    setMovementEditDirection(nextDirection);
    setMovementEditForm({
      quantity: String(Math.abs(movement.delta)),
      quantityUnit: "base",
      type: movement.type as MovementType,
      reason: movement.reason ?? "",
      note: movement.note ?? "",
      location: movement.location ?? "",
      occurredAt: localDateTime(movement.occurredAt),
      totalPrice:
        movement.totalPriceCents === null ||
          movement.totalPriceCents === undefined
          ? ""
          : (movement.totalPriceCents / 100).toFixed(2),
      contactId: movement.contactId ?? "",
    });
    setError(null);
  }

  function closeMovementEditor() {
    setEditingMovementId(null);
    setMovementEditForm(null);
  }

  function selectMovementEditDirection(next: "in" | "out") {
    setMovementEditDirection(next);
    setMovementEditForm((current) =>
      current
        ? {
          ...current,
          type: next === "in" ? "receipt" : "issue",
        }
        : current,
    );
  }

  function updateMovementEdit<K extends keyof MovementForm>(
    key: K,
    value: MovementForm[K],
  ) {
    setMovementEditForm((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }

  function buildMovementEditPayload(movement: StockMovement) {
    if (!movementEditForm) throw new Error(t("resource.errors.checkBooking"));
    return buildStockMovementPayload(movementEditForm, {
      ...payloadOptions,
      mode: "edit",
      direction: movementEditDirection,
      previousDelta: movement.delta,
    });
  }

  async function saveMovementEdit(
    event: FormEvent,
    movement: StockMovement,
  ) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const payload = buildMovementEditPayload(movement);
      setSavingMovementId(movement.id);
      await fetchJson(`${endpoint}/movements/${movement.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeMovementEditor();
      await loadStock(true);
      setNotice(t("resource.notices.movementUpdated"));
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : t("resource.errors.updateMovement"),
      );
    } finally {
      setSavingMovementId(null);
    }
  }

  async function deleteMovement(movement: StockMovement) {
    if (
      deletingMovementId ||
      !window.confirm(t("resource.confirm.deleteMovement"))
    ) {
      return;
    }
    setDeletingMovementId(movement.id);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`${endpoint}/movements/${movement.id}`, {
        method: "DELETE",
      });
      if (editingMovementId === movement.id) closeMovementEditor();
      await loadStock(true);
      setNotice(t("resource.notices.movementDeleted"));
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : t("resource.errors.deleteMovement"),
      );
    } finally {
      setDeletingMovementId(null);
    }
  }

  return {
    direction,
    movementForm,
    pendingMovement,
    setPendingMovement,
    postingMovement,
    editingMovementId,
    movementEditDirection,
    movementEditForm,
    savingMovementId,
    deletingMovementId,
    historyFilter,
    setHistoryFilter,
    purchaseUnit,
    purchaseUnitConfigured,
    enteredUnitName,
    enteredUnitFactor,
    movementTypes,
    filteredMovements,
    selectDirection,
    updateMovement,
    applyPhotoCount,
    submitMovement,
    postMovement,
    startEditingMovement,
    closeMovementEditor,
    selectMovementEditDirection,
    updateMovementEdit,
    saveMovementEdit,
    deleteMovement,
  };
}

export type StockMovementsController = ReturnType<typeof useStockMovements>;
