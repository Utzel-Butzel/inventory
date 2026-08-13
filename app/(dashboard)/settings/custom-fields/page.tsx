import type { Metadata } from "next";

import { CustomFieldManager } from "@/components/custom-field-manager";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { requireSettingsPermission } from "@/lib/settings-access";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.customFields.title"),
    description: t("pages.customFields.metaDescription"),
  };
}

export default async function CustomFieldsSettingsPage() {
  await requireSettingsPermission("settings.custom-fields.manage");
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.customFields.title")}
        description={t("pages.customFields.description")}
      />
      <CustomFieldManager />
    </>
  );
}
