import type { Metadata } from "next";

import { ResourceStockManager } from "@/components/resource-stock-manager";

export const metadata: Metadata = {
  title: "Stock management",
};

type Props = { params: Promise<{ id: string }> };

export default async function ResourceStockPage({ params }: Props) {
  const { id } = await params;
  return <ResourceStockManager resourceId={id} />;
}
