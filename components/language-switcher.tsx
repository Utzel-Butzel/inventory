"use client";

import { Languages } from "lucide-react";
import { useChangeLanguage, useT } from "next-i18next/client";

import { UI_LANGUAGE_COOKIE, UI_LANGUAGES } from "@/i18n.config";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useT("common");
  const changeLanguage = useChangeLanguage(UI_LANGUAGE_COOKIE);
  const resolvedLanguage = i18n.resolvedLanguage?.split("-")[0] ?? "en";

  return (
    <label
      className={
        compact
          ? "relative inline-flex h-9 items-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-foreground"
          : "relative inline-flex h-10 items-center rounded-xl border border-border bg-surface text-muted-strong shadow-sm transition hover:border-border-strong hover:bg-surface-subtle"
      }
    >
      <Languages
        className={compact ? "pointer-events-none ml-2.5 size-4" : "pointer-events-none ml-3 size-4"}
        aria-hidden="true"
      />
      <span className="sr-only">{t("language.label")}</span>
      <select
        value={UI_LANGUAGES.includes(resolvedLanguage as "en" | "de") ? resolvedLanguage : "en"}
        onChange={(event) => void changeLanguage(event.target.value)}
        aria-label={t("language.label")}
        className={
          compact
            ? "h-full cursor-pointer appearance-none bg-transparent pl-1.5 pr-2.5 text-[12px] font-semibold uppercase outline-none"
            : "h-full cursor-pointer appearance-none bg-transparent pl-2 pr-3 text-xs font-semibold outline-none"
        }
      >
        <option value="en">{compact ? "EN" : t("language.english")}</option>
        <option value="de">{compact ? "DE" : t("language.german")}</option>
      </select>
    </label>
  );
}
