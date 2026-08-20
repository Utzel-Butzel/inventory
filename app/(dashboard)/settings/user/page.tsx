import type { Metadata } from "next";
import { Languages } from "lucide-react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { Card } from "@/components/ui";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.user.title"),
    description: t("pages.user.metaDescription"),
  };
}

export default async function UserSettingsPage() {
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.user.title")}
        description={t("pages.user.description")}
      />
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Languages className="size-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              {t("user.language.title")}
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-muted">
              {t("user.language.description")}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-[13px] font-medium text-muted-strong">
            {t("user.language.selectionLabel")}
          </p>
          <LanguageSwitcher />
        </div>
      </Card>
    </>
  );
}
