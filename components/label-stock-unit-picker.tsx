"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useT } from "next-i18next/client";

import { fetchJson } from "@/lib/client-types";
import {
  labelTargetKey,
  type LabelResource,
  type LabelStockUnit,
} from "@/lib/label-target";

export function LabelStockUnitPicker({
  resource,
  selectedIds,
  onToggle,
}: {
  resource: LabelResource;
  selectedIds: Set<string>;
  onToggle: (resource: LabelResource) => void;
}) {
  const { t } = useT("labels");
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [units, setUnits] = useState<LabelStockUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchJson<{ units: LabelStockUnit[] }>(
      `/api/v1/resources/${resource.id}/stock/units`,
      { cache: "no-store", signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setUnits(result.units);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("units.loadError"),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [expanded, resource.id, retry, t]);

  const search = query.trim().toLocaleLowerCase();
  const matchingUnits = units.filter((unit) =>
    [unit.code, unit.id, unit.location].some((value) =>
      value?.toLocaleLowerCase().includes(search),
    ),
  );

  return (
    <div className="border-t border-border/50 px-4 py-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`label-units-${resource.id}`}
        onClick={() => setExpanded((current) => !current)}
        className="flex items-center gap-2 text-xs font-semibold text-brand"
      >
        {expanded ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        {t("units.choose")}
      </button>
      {expanded ? (
        <div id={`label-units-${resource.id}`} className="mt-3 space-y-2 pb-2">
          <p className="text-xs leading-5 text-muted">
            {t("units.description")}
          </p>
          {loading ? (
            <div
              role="status"
              className="flex items-center gap-2 text-xs text-muted"
            >
              <LoaderCircle
                size={14}
                className="animate-spin"
                aria-hidden="true"
              />
              {t("units.loading")}
            </div>
          ) : error ? (
            <div role="alert" className="text-xs text-danger">
              <p>{error}</p>
              <button
                type="button"
                className="mt-2 font-semibold underline"
                onClick={() => setRetry((current) => current + 1)}
              >
                {t("units.retry")}
              </button>
            </div>
          ) : units.length ? (
            <>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t("units.search")}
                placeholder={t("units.search")}
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-focus"
              />
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {matchingUnits.map((unit) => {
                  const target = { ...resource, stockUnit: unit };
                  const selected = selectedIds.has(labelTargetKey(target));
                  return (
                    <button
                      key={unit.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onToggle(target)}
                      className={`flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs ${selected ? "bg-brand-soft" : "hover:bg-surface-hover"}`}
                    >
                      <span
                        className={`grid size-4 shrink-0 place-items-center rounded border ${selected ? "border-brand-solid bg-brand-solid text-on-brand" : "border-border-strong"}`}
                      >
                        {selected ? (
                          <Check size={11} aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="min-w-0 break-words">
                        <span className="font-mono font-semibold">
                          {unit.code}
                        </span>
                        {unit.location ? (
                          <span className="mt-0.5 block text-muted">
                            {unit.location}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
                {!matchingUnits.length ? (
                  <p className="py-2 text-xs text-muted">
                    {t("units.noMatches")}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted">{t("units.empty")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
