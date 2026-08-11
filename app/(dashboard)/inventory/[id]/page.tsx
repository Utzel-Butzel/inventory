import { ResourceEditor } from "@/components/resource-editor";
import { ResourceAssignmentsManager } from "@/components/resource-assignments-manager";
import { ResourceRelationsManager } from "@/components/resource-relations-manager";
import { getSessionIdentity } from "@/lib/api-auth";

type Props = { params: Promise<{ id: string }> };

export default async function InventoryItemPage({ params }: Props) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  return (
    <>
      <ResourceEditor resourceId={id} />
      <ResourceRelationsManager
        resourceId={id}
        canEdit={Boolean(identity?.scopes.includes("write"))}
      />
      <ResourceAssignmentsManager
        resourceId={id}
        canEdit={Boolean(identity?.scopes.includes("write"))}
      />
    </>
  );
}
