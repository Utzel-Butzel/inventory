import type { Metadata } from "next";

import { StockOverview } from "@/components/stock-overview";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("stock");

  return {
    title: t("overview.metadata.title"),
    description: t("overview.metadata.description"),
  };
}

export default function StockPage() {
  return <StockOverview />;
}
