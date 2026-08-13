import type { Metadata } from "next";

import { PublicShareManager } from "@/components/public-share-manager";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { requireSettingsPermission } from "@/lib/settings-access";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.sharing.title"),
    description: t("pages.sharing.metaDescription"),
  };
}

export default async function SharingSettingsPage() {
  await requireSettingsPermission("sharing.manage");
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.sharing.title")}
        description={t("pages.sharing.description")}
      />
      <PublicShareManager />
    </>
  );
}
