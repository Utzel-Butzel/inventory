import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccessManager } from "@/components/access-manager";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.access.title"),
    description: t("pages.access.metaDescription"),
  };
}

export default async function AccessSettingsPage() {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  if (!identity.permissions.includes("roles.manage")) {
    redirect(organizationPath(identity.organizationId, "/settings/data"));
  }
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.access.title")}
        description={t("pages.access.description")}
      />
      <AccessManager />
    </>
  );
}
