import type { Metadata } from "next";

import { InventoryMap } from "@/components/inventory-map";
import { getSessionIdentity } from "@/lib/api-auth";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("spatial");
  return {
    title: t("metadata.mapTitle"),
    description: t("metadata.mapDescription"),
  };
}

export default async function MapPage() {
  const identity = await getSessionIdentity();
  return (
    <InventoryMap
      canEdit={Boolean(identity?.permissions.includes("spatial.manage"))}
    />
  );
}
