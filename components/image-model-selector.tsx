"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { EstimatedAiCost } from "@/components/ai-cost-estimate";
import type { AiCostEstimateCatalog } from "@/lib/ai-cost-estimates";

const storageKey = "inventory.image-generation-model";

export type ImageModelOption = {
  id: string;
  provider: string;
  model: string;
  label: string;
  estimatedCost?: {
    minimumUsd: number;
    maximumUsd: number;
    unit: "imagePass";
  };
  estimatedCostsBySize?: Record<
    string,
    { minimumUsd: number; maximumUsd: number; unit: "imagePass" }
  >;
};

type ImageModelResponse = {
  models?: unknown;
  defaultModelId?: unknown;
  costEstimates?: unknown;
};

export type ImageModelPreference = {
  models: ImageModelOption[];
  defaultModelId: string | undefined;
  selectedModelId: string | undefined;
  selectedModel: ImageModelOption | undefined;
  effectiveModel: ImageModelOption | undefined;
  costEstimates: AiCostEstimateCatalog | null;
  loading: boolean;
  setSelectedModelId: (modelId: string | undefined) => void;
};

const isImageModelOption = (value: unknown): value is ImageModelOption => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ImageModelOption>;
  return [candidate.id, candidate.provider, candidate.model, candidate.label].every(
    (entry) => typeof entry === "string" && entry.trim().length > 0,
  );
};

const isCostCatalog = (value: unknown): value is AiCostEstimateCatalog =>
  Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<AiCostEstimateCatalog>).currency === "USD" &&
      typeof (value as Partial<AiCostEstimateCatalog>).pricingUpdatedAt ===
        "string" &&
      (value as Partial<AiCostEstimateCatalog>).operations,
  );

const readStoredModelId = () => {
  try {
    return window.localStorage.getItem(storageKey)?.trim() || undefined;
  } catch {
    return undefined;
  }
};

const writeStoredModelId = (modelId: string | undefined) => {
  try {
    if (modelId) window.localStorage.setItem(storageKey, modelId);
    else window.localStorage.removeItem(storageKey);
  } catch {
    // A private or restricted browser session can still use the server default.
  }
};

export function useImageModelPreference(): ImageModelPreference {
  const [models, setModels] = useState<ImageModelOption[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string>();
  const [selectedModelId, setSelectedModelIdState] = useState<string | undefined>(
    () => readStoredModelId(),
  );
  const [costEstimates, setCostEstimates] =
    useState<AiCostEstimateCatalog | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch("/api/v1/ai/image-models", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Image model options are unavailable.");
        const payload = (await response.json()) as ImageModelResponse;
        const availableModels = Array.isArray(payload.models)
          ? payload.models.filter(isImageModelOption)
          : [];
        const uniqueModels = availableModels.filter(
          (model, index) =>
            availableModels.findIndex((candidate) => candidate.id === model.id) === index,
        );
        const defaultModelId =
          typeof payload.defaultModelId === "string" &&
          uniqueModels.some((model) => model.id === payload.defaultModelId)
            ? payload.defaultModelId
            : uniqueModels[0]?.id;
        const storedModelId = readStoredModelId();
        const nextModelId = uniqueModels.some((model) => model.id === storedModelId)
          ? storedModelId
          : undefined;

        setModels(uniqueModels);
        setDefaultModelId(defaultModelId);
        setCostEstimates(
          isCostCatalog(payload.costEstimates) ? payload.costEstimates : null,
        );
        setSelectedModelIdState(nextModelId);
        if (storedModelId && !nextModelId) writeStoredModelId(undefined);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Older servers can keep choosing their default when no preference is
        // saved; an explicit preference survives a transient discovery failure.
        setModels([]);
        setDefaultModelId(undefined);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const syncStoredPreference = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      if (!event.newValue) {
        setSelectedModelIdState(undefined);
      } else if (
        !models.length ||
        models.some((model) => model.id === event.newValue)
      ) {
        setSelectedModelIdState(event.newValue);
      }
    };
    window.addEventListener("storage", syncStoredPreference);
    return () => window.removeEventListener("storage", syncStoredPreference);
  }, [models]);

  const setSelectedModelId = useCallback(
    (modelId: string | undefined) => {
      if (modelId && !models.some((model) => model.id === modelId)) return;
      setSelectedModelIdState(modelId);
      writeStoredModelId(modelId);
    },
    [models],
  );

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId],
  );
  const effectiveModel =
    selectedModel ?? models.find((model) => model.id === defaultModelId);

  return {
    models,
    defaultModelId,
    selectedModelId,
    selectedModel,
    effectiveModel,
    costEstimates,
    loading,
    setSelectedModelId,
  };
}

export function ImageModelSelector({
  preference,
  disabled = false,
  label,
  description,
  className = "",
}: {
  preference: ImageModelPreference;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
}) {
  const { t } = useT("common");
  const selectId = useId();
  const descriptionId = useId();

  if (preference.loading || !preference.models.length) {
    return null;
  }

  const defaultModel = preference.models.find(
    (model) => model.id === preference.defaultModelId,
  );

  return (
    <div className={className}>
      <label htmlFor={selectId} className="block text-[13px] font-semibold text-muted">
        {label ?? t("models.image")}
      </label>
      <select
        id={selectId}
        value={preference.selectedModelId ?? ""}
        onChange={(event) =>
          preference.setSelectedModelId(event.target.value || undefined)
        }
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        className="mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-xs text-muted-strong outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted"
      >
        <option value="">
          {t("models.serverDefault")}
          {defaultModel ? ` (${defaultModel.label})` : ""}
        </option>
        {preference.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
      {description ? (
        <p id={descriptionId} className="mt-1 text-[12px] leading-4 text-muted">
          {description}
        </p>
      ) : null}
      <EstimatedAiCost
        estimate={preference.effectiveModel?.estimatedCost}
        className="mt-1"
      />
    </div>
  );
}
