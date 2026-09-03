import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPageHeader } from "@/components/settings-page-header";
import { WooCommerceConnectionManager } from "@/components/woocommerce-connection-manager";
import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.woocommerce.title"),
    description: t("pages.woocommerce.metaDescription"),
  };
}

export default async function WooCommerceSettingsPage() {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  if (!identity.permissions.includes("webhooks.manage")) {
    redirect(organizationPath(identity.organization.slug, "/settings/data"));
  }
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.woocommerce.title")}
        description={t("pages.woocommerce.description")}
      />
      <WooCommerceConnectionManager />
    </>
  );
}
