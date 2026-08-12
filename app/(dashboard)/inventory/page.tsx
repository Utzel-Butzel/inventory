import { InventoryClient } from "@/components/inventory-client";
import { getSessionIdentity } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type InventoryPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const identity = await getSessionIdentity();
  const params = await searchParams;
  const initialQuery = Array.isArray(params.q) ? params.q[0] : params.q;

  return (
    <InventoryClient
      canWrite={Boolean(identity?.scopes.includes("write"))}
      initialQuery={initialQuery ?? ""}
    />
  );
}
