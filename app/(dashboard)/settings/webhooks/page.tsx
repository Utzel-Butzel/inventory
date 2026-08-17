import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPageHeader } from "@/components/settings-page-header";
import { WebhookManager } from "@/components/webhook-manager";
import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.webhooks.title"),
    description: t("pages.webhooks.metaDescription"),
  };
}

export default async function WebhookSettingsPage() {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  if (!identity.permissions.includes("webhooks.manage")) {
    redirect(organizationPath(identity.organization.slug, "/settings/data"));
  }
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.webhooks.title")}
        description={t("pages.webhooks.description")}
      />
      <WebhookManager />
    </>
  );
}
