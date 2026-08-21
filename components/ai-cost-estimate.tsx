"use client";

import { CircleDollarSign } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "next-i18next/client";

import type {
  AiCostEstimate,
  AiCostEstimateCatalog,
} from "@/lib/ai-cost-estimates";

export type DisplayAiCost = Pick<
  AiCostEstimate,
  "minimumUsd" | "maximumUsd" | "unit"
> &
  Partial<Pick<AiCostEstimate, "model" | "provider">>;

let cachedCatalog: AiCostEstimateCatalog | null = null;
let pendingCatalog: Promise<AiCostEstimateCatalog | null> | null = null;

const isCostCatalog = (value: unknown): value is AiCostEstimateCatalog => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiCostEstimateCatalog>;
  return (
    candidate.currency === "USD" &&
    typeof candidate.pricingUpdatedAt === "string" &&
    Boolean(candidate.operations) &&
    typeof candidate.operations === "object"
  );
};

const loadCatalog = () => {
  if (cachedCatalog) return Promise.resolve(cachedCatalog);
  if (pendingCatalog) return pendingCatalog;
  pendingCatalog = fetch("/api/v1/ai/image-models", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = (await response.json()) as { costEstimates?: unknown };
      if (!isCostCatalog(payload.costEstimates)) return null;
      cachedCatalog = payload.costEstimates;
      return cachedCatalog;
    })
    .catch(() => null)
    .finally(() => {
      pendingCatalog = null;
    });
  return pendingCatalog;
};

export function useAiCostEstimateCatalog() {
  const [catalog, setCatalog] = useState<AiCostEstimateCatalog | null>(
    cachedCatalog,
  );

  useEffect(() => {
    let active = true;
    void loadCatalog().then((nextCatalog) => {
      if (active && nextCatalog) setCatalog(nextCatalog);
    });
    return () => {
      active = false;
    };
  }, []);

  return catalog;
}

export const multipliedAiCost = (
  estimate: DisplayAiCost | undefined,
  multiplier: number,
  unit: DisplayAiCost["unit"] = "action",
): DisplayAiCost | undefined =>
  estimate
    ? {
        ...estimate,
        minimumUsd: estimate.minimumUsd * multiplier,
        maximumUsd: estimate.maximumUsd * multiplier,
        unit,
      }
    : undefined;

export const combinedAiCost = (
  estimates: Array<DisplayAiCost | undefined>,
  unit: DisplayAiCost["unit"] = "action",
): DisplayAiCost | undefined => {
  const available = estimates.filter(
    (estimate): estimate is DisplayAiCost => Boolean(estimate),
  );
  if (!available.length) return undefined;
  return {
    minimumUsd: available.reduce(
      (total, estimate) => total + estimate.minimumUsd,
      0,
    ),
    maximumUsd: available.reduce(
      (total, estimate) => total + estimate.maximumUsd,
      0,
    ),
    unit,
  };
};

const usd = (value: number, locale: string) => {
  const fractionDigits = value < 0.01 ? 4 : value < 0.1 ? 3 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
};

export function EstimatedAiCost({
  estimate,
  className = "",
}: {
  estimate?: DisplayAiCost;
  className?: string;
}) {
  const { t, i18n } = useT("common");
  if (!estimate) return null;
  const locale = i18n.resolvedLanguage ?? "en";
  const minimum = usd(estimate.minimumUsd, locale);
  const maximum = usd(estimate.maximumUsd, locale);
  const amount = minimum === maximum ? minimum : `${minimum}–${maximum}`;
  const labelKey =
    estimate.unit === "itemLanguage"
      ? "aiCost.itemLanguage"
      : estimate.unit === "imagePass"
        ? "aiCost.imagePass"
        : "aiCost.action";

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-medium leading-4 text-muted ${className}`}
      title={t("aiCost.disclaimer")}
    >
      <CircleDollarSign className="size-3.5 shrink-0" aria-hidden="true" />
      {t(labelKey, { cost: amount })}
    </span>
  );
}
