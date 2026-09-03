import type { Metadata } from "next";
import { CloudDownload, CodeXml, Languages, ListFilter, Palette } from "lucide-react";

import { DeveloperModeSetting } from "@/components/developer-mode-setting";
import { InventoryPageSizeSetting } from "@/components/inventory-page-size-setting";
import { LanguageSwitcher } from "@/components/language-switcher";
import { OfflineSupportSetting } from "@/components/offline-support";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { LocalizedThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui";
import { getSessionIdentity } from "@/lib/api-auth";
import { normalizeInventoryPageSize } from "@/lib/inventory-pagination";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.user.title"),
    description: t("pages.user.metaDescription"),
  };
}

export default async function UserSettingsPage() {
  const [{ t }, identity] = await Promise.all([
    getT("settings"),
    getSessionIdentity(),
  ]);

  return (
    <>
      <SettingsPageHeader
        title={t("pages.user.title")}
        description={t("pages.user.description")}
      />
      <div className="space-y-4">
        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <Palette className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t("user.appearance.title")}
              </h2>
              <p className="mt-1 text-[15px] leading-5 text-muted">
                {t("user.appearance.description")}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-6">
            <p className="text-[15px] font-medium text-muted-strong">
              {t("user.appearance.selectionLabel")}
            </p>
            <LocalizedThemeToggle />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <CloudDownload className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t("user.offline.title")}
              </h2>
              <p className="mt-1 text-[15px] leading-5 text-muted">
                {t("user.offline.description")}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
            <div className="min-w-0">
              <p className="pt-1 text-[15px] font-medium text-muted-strong">
                {t("user.offline.selectionLabel")}
              </p>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
                {t("user.offline.securityHint")}
              </p>
            </div>
            <OfflineSupportSetting />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <CodeXml className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t("user.developerMode.title")}
              </h2>
              <p className="mt-1 text-[15px] leading-5 text-muted">
                {t("user.developerMode.description")}
              </p>
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6">
            <p className="pt-1 text-[15px] font-medium text-muted-strong">
              {t("user.developerMode.selectionLabel")}
            </p>
            <DeveloperModeSetting
              initialEnabled={identity?.developerMode ?? false}
              disabled={identity?.organization.isReadOnly ?? true}
            />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <ListFilter className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t("user.pagination.title")}
              </h2>
              <p className="mt-1 text-[15px] leading-5 text-muted">
                {t("user.pagination.description")}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
            <p className="pt-2 text-[15px] font-medium text-muted-strong">
              {t("user.pagination.selectionLabel")}
            </p>
            <InventoryPageSizeSetting
              initialPageSize={normalizeInventoryPageSize(
                identity?.inventoryPageSize,
              )}
            />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <Languages className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t("user.language.title")}
              </h2>
              <p className="mt-1 text-[15px] leading-5 text-muted">
                {t("user.language.description")}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-[15px] font-medium text-muted-strong">
              {t("user.language.selectionLabel")}
            </p>
            <LanguageSwitcher />
          </div>
        </Card>
      </div>
    </>
  );
}
