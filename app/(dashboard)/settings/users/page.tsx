import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/settings-page-header";
import { UserManager } from "@/components/user-manager";
import { requireSettingsPermission } from "@/lib/settings-access";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.users.title"),
    description: t("pages.users.metaDescription"),
  };
}

export default async function UsersSettingsPage() {
  await requireSettingsPermission("users.manage");
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.users.title")}
        description={t("pages.users.description")}
      />
      <UserManager />
    </>
  );
}
