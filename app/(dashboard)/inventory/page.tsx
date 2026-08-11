import { InventoryClient } from "@/components/inventory-client";
import { getSessionIdentity } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const identity = await getSessionIdentity();
  return (
    <InventoryClient canWrite={Boolean(identity?.scopes.includes("write"))} />
  );
}
