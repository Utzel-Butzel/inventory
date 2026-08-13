import { ResourceEditor } from "@/components/resource-editor";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { getResourceRecord } from "@/lib/access-control";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default async function EditInventoryItemPage({ params }: Props) {
  const { id } = await params;
  const [identity, resource] = await Promise.all([
    getSessionIdentity(),
    getResourceRecord(id),
  ]);

  if (
    !identity ||
    !resource ||
    !(await canAccessResource(identity, "inventory.update", resource))
  ) {
    redirect(`/inventory/${id}`);
  }

  const [canDelete, canUseAi, canManageSpatial] = await Promise.all([
    canAccessResource(identity, "inventory.delete", resource),
    canAccessResource(identity, "ai.use", resource),
    canAccessResource(identity, "spatial.manage", resource),
  ]);

  return (
    <ResourceEditor
      resourceId={id}
      canDelete={canDelete}
      canUseAi={canUseAi}
      canManageSpatial={canManageSpatial}
    />
  );
}
