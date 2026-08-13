import type { Metadata } from "next";

import { CsvImportExport } from "@/components/csv-import-export";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { getSessionIdentity } from "@/lib/api-auth";
import { listInventoryTypes } from "@/lib/inventory-structure";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.data.title"),
    description: t("pages.data.metaDescription"),
  };
}

export default async function DataSettingsPage() {
  const identity = await getSessionIdentity();
  const [inventoryTypes, { t }] = await Promise.all([
    identity ? listInventoryTypes(identity.organizationId) : Promise.resolve([]),
    getT("settings"),
  ]);

  return (
    <>
      <SettingsPageHeader
        title={t("pages.data.title")}
        description={t("pages.data.description")}
      />
      <CsvImportExport
        allowImport={Boolean(identity?.permissions.includes("inventory.import"))}
        inventoryTypeKeys={inventoryTypes.map((type) => type.key)}
      />
    </>
  );
}
