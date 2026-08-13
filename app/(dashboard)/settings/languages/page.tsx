import type { Metadata } from "next";

import { LanguageManager } from "@/components/language-manager";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { requireSettingsPermission } from "@/lib/settings-access";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.languages.title"),
    description: t("pages.languages.metaDescription"),
  };
}

export default async function LanguagesSettingsPage() {
  await requireSettingsPermission("settings.languages.manage");
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.languages.title")}
        description={t("pages.languages.description")}
      />
      <LanguageManager />
    </>
  );
}
