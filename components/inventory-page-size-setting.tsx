"use client";

import { useState } from "react";
import { useT } from "next-i18next/client";

import { fetchJson } from "@/lib/client-types";
import {
  INVENTORY_PAGE_SIZE_OPTIONS,
  normalizeInventoryPageSize,
  type InventoryPageSize,
} from "@/lib/inventory-pagination";

export function InventoryPageSizeSetting({
  initialPageSize,
}: {
  initialPageSize: number;
}) {
  const { t } = useT("settings");
  const [pageSize, setPageSize] = useState<InventoryPageSize>(() =>
    normalizeInventoryPageSize(initialPageSize),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updatePageSize(nextPageSize: InventoryPageSize) {
    const previousPageSize = pageSize;
    setPageSize(nextPageSize);
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const result = await fetchJson<{
        preferences: { inventoryPageSize: InventoryPageSize };
      }>("/api/v1/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryPageSize: nextPageSize }),
      });
      setPageSize(result.preferences.inventoryPageSize);
      setNotice(t("user.pagination.saved"));
    } catch {
      setPageSize(previousPageSize);
      setError(t("user.pagination.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <label className="relative inline-flex h-10 items-center rounded-xl border border-border bg-surface text-muted-strong shadow-sm transition focus-within:border-success focus-within:ring-4 focus-within:ring-success-border">
        <span className="sr-only">{t("user.pagination.selectionLabel")}</span>
        <select
          value={pageSize}
          disabled={saving}
          onChange={(event) =>
            void updatePageSize(
              normalizeInventoryPageSize(Number(event.target.value)),
            )
          }
          className="h-full cursor-pointer appearance-none bg-transparent px-3 text-xs font-semibold outline-none disabled:cursor-wait disabled:opacity-60"
        >
          {INVENTORY_PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <p
        className={`min-h-4 text-xs ${error ? "text-danger" : "text-muted"}`}
        aria-live="polite"
      >
        {saving
          ? t("user.pagination.saving")
          : error ?? notice ?? t("user.pagination.hint")}
      </p>
    </div>
  );
}
