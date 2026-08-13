import { ResourceEditor } from "@/components/resource-editor";
import { getSessionIdentity } from "@/lib/api-auth";
import { redirect } from "next/navigation";

export default async function NewInventoryItemPage() {
  const identity = await getSessionIdentity();
  if (!identity?.permissions.includes("inventory.create")) redirect("/inventory");

  return (
    <ResourceEditor
      canUseAi={identity.scopes.includes("ai")}
      canManageSpatial={identity.permissions.includes("spatial.manage")}
    />
  );
}
