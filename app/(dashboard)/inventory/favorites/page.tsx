import { InventoryClient } from "@/components/inventory-client";
import { getSessionIdentity } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type FavoritesPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function FavoritesPage({
  searchParams,
}: FavoritesPageProps) {
  const [params, identity] = await Promise.all([
    searchParams,
    getSessionIdentity(),
  ]);
  const initialQuery = Array.isArray(params.q) ? params.q[0] : params.q;

  return (
    <InventoryClient
      favoritesOnly
      initialQuery={initialQuery ?? ""}
      initialPageSize={identity?.inventoryPageSize}
      developerMode={identity?.developerMode ?? false}
    />
  );
}
