import type { Metadata } from "next";

import { OrdersManager } from "@/components/orders-manager";
import { getT } from "@/lib/ui-i18n/server";
import { isResourceId } from "@/lib/resource-short-link";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("orders");
  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
  };
}

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ resourceId?: string | string[] }> }) {
  const { resourceId } = await searchParams;
  const purchaseResourceId = typeof resourceId === "string" && isResourceId(resourceId) ? resourceId : undefined;
  return (
    <main className="app-page mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <OrdersManager type="purchase" purchaseResourceId={purchaseResourceId} />
    </main>
  );
}
