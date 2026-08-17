import { ResourceAssignmentsManager } from "@/components/resource-assignments-manager";
import { ResourceDetails } from "@/components/resource-details";
import { ResourceFamilyManager } from "@/components/resource-family-manager";
import { ResourceRelationsManager } from "@/components/resource-relations-manager";
import { ResourceVariantsManager } from "@/components/resource-variants-manager";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { getResourceRecord } from "@/lib/access-control";

type Props = { params: Promise<{ id: string }> };

export default async function InventoryItemPage({ params }: Props) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  const resource = identity
    ? await getResourceRecord(id, identity.organizationId)
    : null;
  const [canEdit, canDelete, canManageAssignments, canManageStock] =
    identity && resource
      ? await Promise.all([
          canAccessResource(identity, "inventory.update", resource),
          canAccessResource(identity, "inventory.delete", resource),
          canAccessResource(identity, "assignments.manage", resource),
          canAccessResource(identity, "stock.manage", resource),
        ])
      : [false, false, false, false];
  const canShare = Boolean(identity?.permissions.includes("sharing.manage"));
  const canCreate = Boolean(
    canEdit && identity?.permissions.includes("inventory.create"),
  );
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
      <ResourceFamilyManager
        resourceId={id}
        canCreate={canCreate}
        canEdit={canEdit}
        canViewStock={canViewStock}
      />
      <ResourceRelationsManager resourceId={id} canEdit={canEdit} />
      <ResourceVariantsManager
        resourceId={id}
        canEdit={canEdit}
        canManageStock={canManageStock}
        hideWhenEmpty
        allowCreate={false}
      />
      {canViewAssignments ? (
        <ResourceAssignmentsManager
          resourceId={id}
          canEdit={canManageAssignments}
        />
      ) : null}
    </>
  );
}
