"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";

const storageKey = "inventory.count-model";

export type CountModelOption = {
  id: string;
  provider: string;
  model: string;
  label: string;
  description: string;
};

type CountModelResponse = {
  models?: unknown;
  defaultModelId?: unknown;
};

const isCountModelOption = (value: unknown): value is CountModelOption => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CountModelOption>;
  return [
    candidate.id,
    candidate.provider,
    candidate.model,
    candidate.label,
    candidate.description,
  ].every((entry) => typeof entry === "string" && entry.trim().length > 0);
};

const readStoredModelId = () => {
  try {
    return window.localStorage.getItem(storageKey)?.trim() || undefined;
  } catch {
    return undefined;
  }
};

const writeStoredModelId = (modelId: string) => {
  try {
    window.localStorage.setItem(storageKey, modelId);
  } catch {
    // Restricted browser sessions can still use the discovered server default.
  }
};

export function useCountModelPreference() {
  const [models, setModels] = useState<CountModelOption[]>([]);
  const [selectedModelId, setSelectedModelIdState] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/ai/count-models", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Count model options are unavailable.");
        const payload = (await response.json()) as CountModelResponse;
        const available = Array.isArray(payload.models)
          ? payload.models.filter(isCountModelOption)
          : [];
        const unique = available.filter(
          (model, index) =>
            available.findIndex((candidate) => candidate.id === model.id) === index,
        );
        const serverDefault =
          typeof payload.defaultModelId === "string" &&
          unique.some((model) => model.id === payload.defaultModelId)
            ? payload.defaultModelId
            : unique[0]?.id;
        const stored = readStoredModelId();
        const selected = unique.some((model) => model.id === stored)
          ? stored
          : serverDefault;
        setModels(unique);
        setSelectedModelIdState(selected);
        if (selected) writeStoredModelId(selected);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setModels([]);
          setSelectedModelIdState(undefined);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const setSelectedModelId = useCallback(
    (modelId: string) => {
      if (!models.some((model) => model.id === modelId)) return;
      setSelectedModelIdState(modelId);
      writeStoredModelId(modelId);
    },
    [models],
  );
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId],
  );

  return { models, selectedModelId, selectedModel, loading, setSelectedModelId };
}

export function CountModelSelector({
  preference,
  disabled = false,
  onChange,
}: {
  preference: ReturnType<typeof useCountModelPreference>;
  disabled?: boolean;
  onChange?: () => void;
}) {
  const selectId = useId();
  const descriptionId = useId();
  if (preference.loading || !preference.models.length) return null;

  return (
    <div className="mb-3 rounded-xl border border-violet-100 bg-white p-3">
      <label htmlFor={selectId} className="block text-[11px] font-semibold text-slate-700">
        Counting model
      </label>
      <select
        id={selectId}
        value={preference.selectedModelId ?? ""}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(event) => {
          preference.setSelectedModelId(event.target.value);
          onChange?.();
        }}
        className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:bg-slate-50"
      >
        {preference.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
      <p id={descriptionId} className="mt-1 text-[10px] leading-4 text-slate-600">
        {preference.selectedModel?.description}
      </p>
    </div>
  );
}
