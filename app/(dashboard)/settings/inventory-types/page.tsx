import type { Metadata } from "next";

import { InventoryTypeManager } from "@/components/inventory-type-manager";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { requireSettingsPermission } from "@/lib/settings-access";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.inventoryTypes.title"),
    description: t("pages.inventoryTypes.metaDescription"),
  };
}

export default async function InventoryTypesSettingsPage() {
  await requireSettingsPermission("settings.inventory-types.manage");
  const { t } = await getT("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("pages.inventoryTypes.title")}
        description={t("pages.inventoryTypes.description")}
      />
      <InventoryTypeManager />
    </>
  );
}
