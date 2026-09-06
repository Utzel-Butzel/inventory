"use client";

import { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  LoaderCircle,
  LockKeyhole,
  PackageCheck,
  RotateCcw,
} from "lucide-react";
import { useT } from "next-i18next/client";

import { ActionChainRunner } from "@/components/action-chain-runner";
import { Button, cn } from "@/components/ui";
import type { PublicActionFlowView } from "@/lib/public-action-flows";

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/10";
const labelClass = "block text-[14px] font-semibold text-muted-strong";

export function PublicActionFlow({ action }: { action: PublicActionFlowView }) {
  const { t } = useT("scanner");
  const [code, setCode] = useState("");
  const [inputs, setInputs] = useState<Record<string, string | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const initialTargets = () =>
    Object.fromEntries(
      action.targetGroups
        .filter(
          (_group, index) =>
            action.targetSelectionMode !== "checkbox" &&
            (action.targetSelectionMode !== "radio" || index === 0),
        )
        .flatMap((group) =>
          group.options[0] ? [[group.resourceId, group.options[0].id]] : [],
        ),
    );
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>(
    initialTargets,
  );

  const unsupportedRequiredField = action.inputFields.find(
    (field) =>
      field.required && (field.type === "media" || field.type === "file"),
  );
  const quantity = useMemo(() => {
    if (action.quantityInputKey) {
      const value = inputs[action.quantityInputKey];
      return typeof value === "string" && value ? Number(value) : null;
    }
    return action.operation.type === "unit" ? 1 : action.operation.quantity;
  }, [action.operation, action.quantityInputKey, inputs]);

  const operationText =
    action.operation.type === "unit"
      ? t("publicAction.operation.unit")
      : action.operation.type === "assembly-build"
        ? t("publicAction.operation.assembly", { count: quantity ?? 0 })
        : t(
            action.operation.direction === "in"
              ? "publicAction.operation.stockIn"
              : "publicAction.operation.stockOut",
            { count: quantity ?? 0 },
          );

  const setInput = (key: string, value: string | boolean) =>
    setInputs((current) => ({ ...current, [key]: value }));

  const reset = () => {
    setCode("");
    setInputs({});
    setError(null);
    setCompleted(false);
    setSelectedTargets(initialTargets());
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (unsupportedRequiredField) {
      setError(t("publicAction.errors.fileUnsupported"));
      return;
    }
    if (action.requiresCode && !code.trim()) {
      setError(t("publicAction.errors.codeRequired"));
      return;
    }
    const selectedResourceIds = Object.values(selectedTargets);
    if (!selectedResourceIds.length) {
      setError(t("publicAction.errors.targetRequired"));
      return;
    }
    if (
      action.targetSelectionMode === "all" &&
      selectedResourceIds.length !== action.targetGroups.length
    ) {
      setError(t("publicAction.errors.allTargetsRequired"));
      return;
    }
    const cleaned: Record<string, string | number | boolean> = {};
    for (const field of action.inputFields) {
      if (field.type === "media" || field.type === "file") continue;
      const value = inputs[field.key];
      if (value === undefined || value === "") {
        if (field.required) {
          setError(t("publicAction.errors.required", { field: field.label }));
          return;
        }
        continue;
      }
      cleaned[field.key] =
        field.type === "number" ? Number(value) : value;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/public/action-flows/${encodeURIComponent(action.triggerId)}/execute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            ...(action.requiresCode ? { code: code.trim() } : {}),
            inputs: cleaned,
            selectedResourceIds,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || t("publicAction.errors.execute"));
      }
      setCompleted(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t("publicAction.errors.execute"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (action.hasActions) return <ActionChainRunner publicTriggerId={action.triggerId} />;

  if (completed) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-5 py-10">
        <section className="w-full rounded-3xl border border-success-border bg-surface p-6 text-center shadow-[var(--shadow-lg)] sm:p-8">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success-soft text-success">
            <CheckCircle2 className="size-7" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold text-foreground">
            {t("publicAction.success.title")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            {t("publicAction.success.description", { action: operationText })}
          </p>
          <Button onClick={reset} className="mt-6 w-full" size="lg">
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("publicAction.success.again")}
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.13em] text-muted">
        <span className="grid size-8 place-items-center rounded-xl bg-brand-soft text-brand">
          <PackageCheck className="size-4" aria-hidden="true" />
        </span>
        {t("publicAction.eyebrow")}
      </header>

      <form
        onSubmit={(event) => void submit(event)}
        className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-lg)]"
      >
        <div className="border-b border-border bg-[linear-gradient(135deg,var(--color-brand-soft),var(--color-surface))] p-5 sm:p-7">
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[29px]">
            {action.name}
          </h1>
          {action.description ? (
            <p className="mt-2 text-sm leading-6 text-muted">{action.description}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2 text-[12px] font-semibold">
            <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-muted-strong">
              {action.resourceName}
            </span>
            <span className="rounded-full border border-brand-border bg-brand-soft px-3 py-1.5 text-brand-strong">
              {operationText}
            </span>
          </div>
        </div>

        <div className="space-y-4 p-5 sm:p-7">
          {action.requiresCode ? (
            <label className={labelClass}>
              {t("publicAction.code", { key: action.identifierLabel })}
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className={inputClass}
                placeholder={t("publicAction.codePlaceholder")}
                autoComplete="off"
                required
              />
            </label>
          ) : null}

          {action.targetGroups.length > 1 ||
          action.targetGroups.some((group) => group.options.length > 1) ? (
            <fieldset>
              <legend className={labelClass}>{t("publicAction.targets.title")}</legend>
              <p className="mt-1 text-xs leading-5 text-muted">
                {t(`publicAction.targets.modes.${action.targetSelectionMode}`)}
              </p>
              <div className="mt-3 space-y-3">
                {action.targetGroups.map((group) => {
                  const selectedOptionId = selectedTargets[group.resourceId];
                  const targetSelected = Boolean(selectedOptionId);
                  const hasVariations = group.options.length > 1;
                  const selectTarget = () =>
                    setSelectedTargets((current) => {
                      if (action.targetSelectionMode === "all") return current;
                      if (
                        action.targetSelectionMode === "checkbox" &&
                        current[group.resourceId]
                      ) {
                        const next = { ...current };
                        delete next[group.resourceId];
                        return next;
                      }
                      const value =
                        current[group.resourceId] ?? group.options[0]?.id;
                      return action.targetSelectionMode === "radio"
                        ? value
                          ? { [group.resourceId]: value }
                          : {}
                        : value
                          ? { ...current, [group.resourceId]: value }
                          : current;
                    });
                  return (
                    <div
                      key={group.resourceId}
                      className={cn(
                        "rounded-xl border p-3.5",
                        targetSelected
                          ? "border-brand-border bg-brand-soft/50"
                          : "border-border bg-surface-subtle",
                      )}
                    >
                      <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-foreground">
                        {action.targetSelectionMode === "all" ? (
                          <Check className="size-4 text-brand" aria-hidden="true" />
                        ) : (
                          <input
                            type={
                              action.targetSelectionMode === "radio"
                                ? "radio"
                                : "checkbox"
                            }
                            name={
                              action.targetSelectionMode === "radio"
                                ? "action-target"
                                : `action-target-${group.resourceId}`
                            }
                            checked={targetSelected}
                            onChange={selectTarget}
                            className="size-4 accent-brand-solid"
                          />
                        )}
                        {group.name}
                      </label>
                      {hasVariations && targetSelected ? (
                        <div
                          role="radiogroup"
                          aria-label={t("publicAction.targets.variationFor", {
                            name: group.name,
                          })}
                          className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2"
                        >
                          {group.options.map((option) => {
                            const selected = selectedOptionId === option.id;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() =>
                                  setSelectedTargets((current) => ({
                                    ...(action.targetSelectionMode === "radio"
                                      ? {}
                                      : current),
                                    [group.resourceId]: option.id,
                                  }))
                                }
                                className={cn(
                                  "flex min-h-10 items-center gap-2 rounded-lg border px-3 text-left text-xs font-semibold transition",
                                  selected
                                    ? "border-brand-border bg-surface text-brand-strong"
                                    : "border-border bg-surface text-muted-strong hover:border-border-strong",
                                )}
                              >
                                <span className="flex-1">{option.name}</span>
                                {selected ? (
                                  <Check className="size-3.5" aria-hidden="true" />
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {action.inputFields.map((field) => {
            const value = inputs[field.key];
            if (field.type === "media" || field.type === "file") {
              return (
                <div key={field.key} className="rounded-xl border border-border bg-surface-subtle p-3.5 text-sm text-muted">
                  <strong className="block text-muted-strong">
                    {field.label}{field.required ? " *" : ""}
                  </strong>
                  <span className="mt-1 block text-xs">
                    {t("publicAction.fileUnsupported")}
                  </span>
                </div>
              );
            }
            if (field.type === "checkbox") {
              return (
                <label key={field.key} className="flex items-center gap-3 rounded-xl border border-border bg-surface-subtle p-3.5 text-sm font-semibold text-muted-strong">
                  <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(event) => setInput(field.key, event.target.checked)}
                    className="size-5 accent-brand-solid"
                  />
                  {field.label}{field.required ? " *" : ""}
                </label>
              );
            }
            if (field.type === "radio") {
              return (
                <fieldset key={field.key}>
                  <legend className={labelClass}>{field.label}{field.required ? " *" : ""}</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {field.options.map((option) => {
                      const selected = value === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setInput(field.key, option.value)}
                          className={cn(
                            "flex min-h-11 items-center gap-2.5 rounded-xl border px-3.5 text-left text-sm font-semibold transition",
                            selected
                              ? "border-brand-border bg-brand-soft text-brand-strong"
                              : "border-border bg-surface text-muted-strong hover:border-border-strong",
                          )}
                        >
                          {option.color ? (
                            <span className="size-4 rounded-full border border-black/10" style={{ backgroundColor: option.color }} />
                          ) : null}
                          <span className="flex-1">{option.label}</span>
                          {selected ? <Check className="size-4" aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              );
            }
            if (field.type === "select") {
              return (
                <label key={field.key} className={labelClass}>
                  {field.label}{field.required ? " *" : ""}
                  <select
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) => setInput(field.key, event.target.value)}
                    className={inputClass}
                    required={field.required}
                  >
                    <option value="">—</option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              );
            }
            const shared = {
              value: typeof value === "string" ? value : "",
              onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setInput(field.key, event.target.value),
              placeholder: field.placeholder,
              required: field.required,
            };
            return (
              <label key={field.key} className={labelClass}>
                {field.label}{field.required ? " *" : ""}
                {field.type === "textarea" ? (
                  <textarea {...shared} rows={4} className={cn(inputClass, "h-auto py-3")} />
                ) : (
                  <input
                    {...shared}
                    type={field.type === "number" ? "number" : "text"}
                    min={field.key === action.quantityInputKey ? 1 : undefined}
                    step={field.key === action.quantityInputKey ? 1 : undefined}
                    inputMode={field.type === "number" ? "numeric" : undefined}
                    className={inputClass}
                  />
                )}
              </label>
            );
          })}

          {error ? (
            <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft px-3.5 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting || Boolean(unsupportedRequiredField)}
          >
            {submitting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
            {submitting ? t("publicAction.submitting") : t("publicAction.confirm")}
          </Button>
        </div>

        <footer className="flex items-start gap-2 border-t border-border bg-surface-subtle px-5 py-4 text-[12px] leading-5 text-muted sm:px-7">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
          {t("publicAction.security")}
        </footer>
      </form>
    </main>
  );
}
