import type { Metadata } from "next";
import { StockPlanning } from "@/components/stock-planning";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("stock");
  return { title: t("planning.title"), description: t("planning.description") };
}

export default function StockForecastPage() {
  return <StockPlanning />;
}
