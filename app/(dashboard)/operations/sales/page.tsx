import type { Metadata } from "next";

import { OrdersManager } from "@/components/orders-manager";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("orders");
  return {
    title: t("title.sale"),
    description: t("description.sale"),
  };
}

export default function SalesPage() {
  return (
    <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <OrdersManager type="sale" />
    </main>
  );
}
