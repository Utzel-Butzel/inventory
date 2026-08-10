import type { Metadata } from "next";

import { PurchaseOrdersManager } from "@/components/purchase-orders-manager";
import { StockSectionNav } from "@/components/stock-section-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Purchase orders | Inventree",
  description: "Track incoming inventory and receive partial deliveries into stock.",
};

export default function PurchaseOrdersPage() {
  return (
    <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <StockSectionNav />
      <PurchaseOrdersManager />
    </main>
  );
}
