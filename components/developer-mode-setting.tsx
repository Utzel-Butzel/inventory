"use client";

import { useRouter } from "next/navigation";
import { useT } from "next-i18next/client";
import { useState } from "react";

import { fetchJson } from "@/lib/client-types";

export function DeveloperModeSetting({
  initialEnabled,
  disabled = false,
}: {
  initialEnabled: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { t } = useT("settings");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateDeveloperMode(nextEnabled: boolean) {
    const previousEnabled = enabled;
    setEnabled(nextEnabled);
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const result = await fetchJson<{
        preferences: { developerMode: boolean };
      }>("/api/v1/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ developerMode: nextEnabled }),
      });
      setEnabled(result.preferences.developerMode);
      setNotice(t("user.developerMode.saved"));
      router.refresh();
    } catch {
      setEnabled(previousEnabled);
      setError(t("user.developerMode.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t("user.developerMode.selectionLabel")}
        disabled={disabled || saving}
        onClick={() => void updateDeveloperMode(!enabled)}
        className={`relative h-7 w-12 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled
            ? "border-brand bg-brand-solid"
            : "border-border-strong bg-surface-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 grid size-[22px] place-items-center rounded-full bg-white shadow-sm transition-transform ${
            enabled ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
          aria-hidden="true"
        />
      </button>
      <p
        className={`min-h-4 text-right text-xs ${error ? "text-danger" : "text-muted"}`}
        aria-live="polite"
      >
        {saving
          ? t("user.developerMode.saving")
          : error ??
            notice ??
            t(
              disabled
                ? "user.developerMode.readOnly"
                : enabled
                  ? "user.developerMode.enabled"
                  : "user.developerMode.disabled",
            )}
      </p>
    </div>
  );
}
