import { InventoryClient } from "@/components/inventory-client";
import { getSessionIdentity } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type InventoryPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const [params, identity] = await Promise.all([
    searchParams,
    getSessionIdentity(),
  ]);
  const initialQuery = Array.isArray(params.q) ? params.q[0] : params.q;

  return (
    <InventoryClient
      initialQuery={initialQuery ?? ""}
      initialPageSize={identity?.inventoryPageSize}
      developerMode={identity?.developerMode ?? false}
    />
  );
}
