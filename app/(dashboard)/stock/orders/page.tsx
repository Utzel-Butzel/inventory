import type { Metadata } from "next";

import { PurchaseOrdersManager } from "@/components/purchase-orders-manager";
import { StockSectionNav } from "@/components/stock-section-nav";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("stock");

  return {
    title: t("orders.metadata.title"),
    description: t("orders.metadata.description"),
  };
}

export default async function PurchaseOrdersPage() {
  await getT("stock");

  return (
    <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <StockSectionNav />
      <PurchaseOrdersManager />
    </main>
  );
}
