"use client";

import { GitBranch } from "lucide-react";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { Toggle } from "./fields";
import type { StockItem, WorkflowStepProps } from "./types";

export function WorkflowVariantInput({
  draft, setDraft, editable, t, resources,
}: Omit<WorkflowStepProps, "integer"> & { resources: StockItem[] }) {
  const targets = draft.resourceIds.flatMap((id) => {
    const resource = resources.find((item) => item.resourceId === id);
    return resource ? [resource] : [];
  });

  return (
    <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[13px] font-semibold text-muted-strong">
            <GitBranch className="size-4 text-brand" aria-hidden="true" />
            {t("workflows.steps.inputs.variants.title")}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-muted">
            {t("workflows.steps.inputs.variants.description")}
          </p>
        </div>
        <Toggle
          label={t("workflows.steps.inputs.variants.toggle")}
          checked={draft.allowVariantSelection}
          disabled={!editable}
          onChange={(allowVariantSelection) => setDraft((current) => ({ ...current, allowVariantSelection }))}
        />
      </div>
      {draft.allowVariantSelection ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {!targets.length ? <p className="text-[12px] text-muted">{t("workflows.steps.inputs.variants.chooseTarget")}</p> : null}
          {targets.map((target) => {
            const variants = resources.filter((item) => item.variantOfResourceId === target.resourceId);
            return (
              <div key={target.resourceId}>
                <p className="text-[12px] font-semibold text-muted-strong">{target.name}</p>
                {variants.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("workflows.steps.inputs.variants.optionsFor", { name: target.name })}>
                    {variants.map((variant) => <li key={variant.resourceId} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted-strong">{variant.name}</li>)}
                  </ul>
                ) : (
                  <p className="mt-1 text-[12px] leading-5 text-muted">{t("workflows.steps.inputs.variants.empty")}</p>
                )}
                <Link href={`/inventory/${target.resourceId}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[12px] font-semibold text-brand hover:underline">
                  {t("workflows.steps.inputs.variants.manage", { name: target.name })}
                </Link>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
