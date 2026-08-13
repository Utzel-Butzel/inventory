import type { Metadata } from "next";

import { NotificationSettingsManager } from "@/components/notification-settings-manager";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.notifications.title"),
    description: t("pages.notifications.metaDescription"),
  };
}

export default async function NotificationSettingsPage() {
  const { t } = await getT("settings");
  return (
    <>
      <SettingsPageHeader
        title={t("pages.notifications.title")}
        description={t("pages.notifications.description")}
      />
      <NotificationSettingsManager />
    </>
  );
}
