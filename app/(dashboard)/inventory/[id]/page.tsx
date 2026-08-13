import { ResourceAssignmentsManager } from "@/components/resource-assignments-manager";
import { ResourceDetails } from "@/components/resource-details";
import { ResourceRelationsManager } from "@/components/resource-relations-manager";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { getResourceRecord } from "@/lib/access-control";

type Props = { params: Promise<{ id: string }> };

export default async function InventoryItemPage({ params }: Props) {
  const { id } = await params;
  const [identity, resource] = await Promise.all([
    getSessionIdentity(),
    getResourceRecord(id),
  ]);
  const [canEdit, canDelete, canManageAssignments] =
    identity && resource
      ? await Promise.all([
          canAccessResource(identity, "inventory.update", resource),
          canAccessResource(identity, "inventory.delete", resource),
          canAccessResource(identity, "assignments.manage", resource),
        ])
      : [false, false, false];
  const canShare = Boolean(identity?.permissions.includes("sharing.manage"));
  const canViewStock = Boolean(identity?.permissions.includes("stock.read"));
  const canViewAssignments = Boolean(
    identity?.permissions.includes("assignments.read"),
  );

  return (
    <>
      <ResourceDetails
        resourceId={id}
        canEdit={canEdit}
        canDelete={canDelete}
        canShare={canShare}
        canViewStock={canViewStock}
      />
      <ResourceRelationsManager resourceId={id} canEdit={canEdit} />
      {canViewAssignments ? (
        <ResourceAssignmentsManager
          resourceId={id}
          canEdit={canManageAssignments}
        />
      ) : null}
    </>
  );
}
