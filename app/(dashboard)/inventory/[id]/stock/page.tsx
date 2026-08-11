import type { Metadata } from "next";

import { ResourceStockManager } from "@/components/resource-stock-manager";
import { getSessionIdentity } from "@/lib/api-auth";

export const metadata: Metadata = {
  title: "Stock management",
};

type Props = { params: Promise<{ id: string }> };

export default async function ResourceStockPage({ params }: Props) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  return (
    <ResourceStockManager
      resourceId={id}
      canEdit={Boolean(identity?.scopes.includes("write"))}
    />
  );
}
