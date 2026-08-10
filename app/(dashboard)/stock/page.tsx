import type { Metadata } from "next";

import { StockOverview } from "@/components/stock-overview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stock",
  description: "Monitor inventory levels, runway, and reorder risk.",
};

export default function StockPage() {
  return <StockOverview />;
}
