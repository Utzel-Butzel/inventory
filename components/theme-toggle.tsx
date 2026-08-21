"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useT } from "next-i18next/client";

import { cn } from "@/components/ui";

type Theme = "light" | "dark";
const themeStorageKey = "inventory-theme";

function resolvedTheme(): Theme {
  const explicitTheme = document.documentElement.dataset.theme;
  if (explicitTheme === "light" || explicitTheme === "dark") {
    return explicitTheme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function updateThemeColor(theme: Theme) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(
    (meta) => meta.setAttribute("content", theme === "dark" ? "#0a0c10" : "#f6f7f9"),
  );
}

function savedTheme(): Theme | null {
  try {
    const theme = localStorage.getItem(themeStorageKey);
    return theme === "light" || theme === "dark" ? theme : null;
  } catch {
    return null;
  }
}

function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(themeStorageKey, theme);
  } catch {}
  try {
    document.cookie = `${themeStorageKey}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {}
}

type ThemeToggleProps = {
  className?: string;
  lightLabel?: string;
  darkLabel?: string;
  pendingLabel?: string;
};

export function ThemeToggle({
  className,
  lightLabel = "Use light theme",
  darkLabel = "Use dark theme",
  pendingLabel = "Toggle color theme",
}: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      if (!document.documentElement.dataset.theme) {
        const nextTheme = media.matches ? "dark" : "light";
        setTheme(nextTheme);
        updateThemeColor(nextTheme);
      }
    };

    const storedTheme = savedTheme();
    if (!document.documentElement.dataset.theme && storedTheme) {
      document.documentElement.dataset.theme = storedTheme;
      saveTheme(storedTheme);
    }
    const initialTheme = resolvedTheme();
    setTheme(initialTheme);
    updateThemeColor(initialTheme);
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = resolvedTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    saveTheme(nextTheme);
    updateThemeColor(nextTheme);
    setTheme(nextTheme);
  }

  const dark = theme === "dark";
  const label = theme === null ? pendingLabel : dark ? lightLabel : darkLabel;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "grid size-9 place-items-center rounded-xl border border-border bg-surface text-muted shadow-sm transition hover:bg-surface-hover hover:text-foreground",
        className,
      )}
      aria-label={label}
      title={label}
    >
      {theme === null ? (
        <span className="size-[17px] rounded-full border-2 border-current opacity-55" aria-hidden="true" />
      ) : dark ? (
        <Sun className="size-[17px]" aria-hidden="true" />
      ) : (
        <Moon className="size-[17px]" aria-hidden="true" />
      )}
    </button>
  );
}

export function LocalizedThemeToggle({ className }: { className?: string }) {
  const { t } = useT("common");
  return (
    <ThemeToggle
      className={className}
      lightLabel={t("theme.light")}
      darkLabel={t("theme.dark")}
      pendingLabel={t("theme.toggle")}
    />
  );
}
