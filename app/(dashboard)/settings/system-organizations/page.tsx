import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { SettingsPageHeader } from "@/components/settings-page-header";
import { SuperadminOrganizationManager } from "@/components/superadmin-organization-manager";
import { getSessionIdentity } from "@/lib/api-auth";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.systemOrganizations.title"),
    description: t("pages.systemOrganizations.metaDescription"),
  };
}

export default async function SystemOrganizationsPage() {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  if (!identity.isSuperAdmin) notFound();
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.systemOrganizations.title")}
        description={t("pages.systemOrganizations.description")}
      />
      <SuperadminOrganizationManager />
    </>
  );
}
