"use client";

import { OrganizationLink as Link } from "@/components/organization-routing";
import { ArrowRight, Check, PackageCheck } from "lucide-react";
import { useMemo } from "react";

import {
  InventorySelect,
  type InventorySelectItem,
} from "@/components/inventory-select";
import { Badge, cn } from "@/components/ui";

import { FlowStep } from "./fields";
import type { StockItem, WorkflowStepProps } from "./types";
import { workflowTargetIssues } from "./validation";

type WorkflowTargetStepProps = WorkflowStepProps & {
  resources: StockItem[];
  selectedResources: StockItem[];
  locale: string;
  targetQuery: string;
  setTargetQuery: (query: string) => void;
};

export function WorkflowTargetStep({
  draft,
  setDraft,
  editable,
  t,
  integer,
  resources,
  selectedResources,
  locale,
  targetQuery,
  setTargetQuery,
}: WorkflowTargetStepProps) {
  const targetIssues = workflowTargetIssues(draft, resources);
  const targetItems = useMemo(() => {
    const normalizedQuery = targetQuery.trim().toLocaleLowerCase(locale);
    return resources
      .filter(
        (resource) =>
          !normalizedQuery ||
          resource.name.toLocaleLowerCase(locale).includes(normalizedQuery) ||
          resource.sku?.toLocaleLowerCase(locale).includes(normalizedQuery),
      )
      .map((resource) => ({
        id: resource.resourceId,
        name: resource.name,
        sku: resource.sku,
        type: resource.type,
        quantity: resource.quantity,
        trackingMode: resource.trackingMode,
        cover: resource.cover,
      }));
  }, [locale, resources, targetQuery]);
  const toggleTargetResource = (selectedItem: InventorySelectItem) => {
    const resource = resources.find(
      (candidate) => candidate.resourceId === selectedItem.id,
    );
    if (!resource) return;
    setDraft((current) => {
      const checked = current.resourceIds.includes(resource.resourceId);
      const resourceIds = checked
        ? current.resourceIds.filter(
          (resourceId) => resourceId !== resource.resourceId,
        )
        : [
          ...current.resourceIds.filter((resourceId) => {
            if (resource.variantOfResourceId === resourceId) return false;
            return !resources.some(
              (candidate) =>
                candidate.resourceId === resourceId &&
                candidate.variantOfResourceId === resource.resourceId,
            );
          }),
          resource.resourceId,
        ];
      return {
        ...current,
        resourceIds,
        resourceId: resourceIds[0] ?? "",
        targetSelectionMode:
          resourceIds.length < 2 ? "all" : current.targetSelectionMode,
      };
    });
  };

  return (
    <FlowStep
      number={integer.format(3)}
      icon={<PackageCheck className="size-[18px] sm:size-5" aria-hidden="true" />}
      title={t("workflows.steps.target.title")}
      description={t("workflows.steps.target.description")}
    >
      {resources.length ? (
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] leading-5 text-muted">
              {t("workflows.steps.target.searchDescription")}
            </p>
            <Badge tone="neutral">
              {t("workflows.steps.target.selectedCount", {
                count: draft.resourceIds.length,
              })}
            </Badge>
          </div>
          <InventorySelect
            className="mt-2"
            items={targetItems}
            selectedIds={draft.resourceIds}
            onSelect={toggleTargetResource}
            query={targetQuery}
            onQueryChange={setTargetQuery}
            label={t("workflows.steps.target.field")}
            placeholder={t("workflows.steps.target.searchPlaceholder")}
            emptyText={t("workflows.steps.target.noMatches")}
            searchingText={t("workflows.steps.target.searching")}
            selectedText={t("workflows.steps.target.selectedShort")}
            disabled={!editable}
            itemMeta={(item) => {
              const resource = resources.find(
                (candidate) => candidate.resourceId === item.id,
              );
              if (!resource) return item.sku || item.type || "—";
              const parent = resource.variantOfResourceId
                ? resources.find(
                  (candidate) =>
                    candidate.resourceId === resource.variantOfResourceId,
                )
                : null;
              if (parent) {
                return t("workflows.steps.target.variantOf", {
                  name: parent.name,
                });
              }
              const quantity = t(
                "workflows.steps.target.resourceQuantity",
                {
                  name: "",
                  quantity: integer.format(resource.quantity ?? 0),
                  unit:
                    resource.unitName ??
                    t("workflows.steps.target.units", {
                      count: resource.quantity ?? 0,
                    }),
                },
              ).replace(/^\s*·\s*/, "");
              return resource.sku ? `${resource.sku} · ${quantity}` : quantity;
            }}
          />

          {draft.resourceIds.length > 1 ? (
            <fieldset className="mt-4 rounded-xl border border-border bg-surface-subtle p-3.5">
              <legend className="px-1 text-[12px] font-semibold text-muted-strong">
                {t("workflows.steps.target.executionMode")}
              </legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-3">
                {(["all", "radio", "checkbox"] as const).map((mode) => (
                  <label
                    key={mode}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-[12px]",
                      draft.targetSelectionMode === mode
                        ? "border-brand-border text-brand-strong"
                        : "border-border text-muted-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="target-selection-mode"
                      value={mode}
                      checked={draft.targetSelectionMode === mode}
                      disabled={!editable}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          targetSelectionMode: mode,
                        }))
                      }
                      className="mt-0.5 accent-brand-solid"
                    />
                    <span>
                      <strong className="block font-semibold">
                        {t(`workflows.steps.target.modes.${mode}.label`)}
                      </strong>
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                        {t(`workflows.steps.target.modes.${mode}.description`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-warning-border bg-warning-soft p-3.5 text-[13px] leading-5 text-warning sm:flex-row sm:items-center sm:justify-between">
          <span>{t("workflows.steps.target.none")}</span>
          <Link href="/inventory" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
            {t("workflows.steps.target.configure")} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}
      {targetIssues.map(({ resource, messageKey }) => (
        <div key={resource.resourceId} role="alert" className="mt-3 rounded-xl border border-warning-border bg-warning-soft p-3 text-[13px] leading-5 text-warning">
          <p>{t(messageKey, { name: resource.name })}</p>
          {messageKey !== "workflows.validation.executionStorage" ? (
            <Link href={`/inventory/${resource.resourceId}/stock/settings`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold hover:underline">
              {t("workflows.steps.target.openStockSettings", { name: resource.name })}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ))}
      {selectedResources.length && !targetIssues.length ? (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-success-border bg-success-soft p-3">
          <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
          <p className="text-[12px] text-success">
            {t("workflows.steps.target.selected", {
              name: selectedResources.map((resource) => resource.name).join(", "),
            })}
          </p>
        </div>
      ) : null}
    </FlowStep>
  );
}
