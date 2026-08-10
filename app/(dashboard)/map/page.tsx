import { InventoryMap } from "@/components/inventory-map";
import { getSessionIdentity } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const identity = await getSessionIdentity();
  return <InventoryMap canEdit={Boolean(identity && identity.role !== "viewer")} />;
}
