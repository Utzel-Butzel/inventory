import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AiUsageManager } from "@/components/ai-usage-manager";
import { OrganizationManager } from "@/components/organization-manager";
import { OrganizationStorageUsage } from "@/components/organization-storage-usage";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { getSessionIdentity } from "@/lib/api-auth";
import { usersCanCreateOrganizations } from "@/lib/deployment-access";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.organization.title"),
    description: t("pages.organization.metaDescription"),
  };
}

export default async function OrganizationSettingsPage() {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.organization.title")}
        description={t("pages.organization.description")}
      />
      <div className="space-y-6">
        <OrganizationManager
          canCreateOrganizations={
            identity.isSuperAdmin || usersCanCreateOrganizations()
          }
        />
        {identity.permissions.includes("roles.manage") ? (
          <>
            <OrganizationStorageUsage organizationId={identity.organizationId} />
            <AiUsageManager />
          </>
        ) : null}
      </div>
    </>
  );
}
