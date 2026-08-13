import { InventoryClient } from "@/components/inventory-client";

export const dynamic = "force-dynamic";

type InventoryPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await searchParams;
  const initialQuery = Array.isArray(params.q) ? params.q[0] : params.q;

  return <InventoryClient initialQuery={initialQuery ?? ""} />;
}
