import type { Metadata } from "next";

import { OrganizationManager } from "@/components/organization-manager";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.organization.title"),
    description: t("pages.organization.metaDescription"),
  };
}

export default async function OrganizationSettingsPage() {
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.organization.title")}
        description={t("pages.organization.description")}
      />
      <OrganizationManager />
    </>
  );
}
