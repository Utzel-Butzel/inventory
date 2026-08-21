import { ResourceAssignmentsManager } from "@/components/resource-assignments-manager";
import { ResourceConnectionDiagram } from "@/components/resource-connection-diagram";
import { ResourceComments } from "@/components/resource-comments";
import { ResourceDetails } from "@/components/resource-details";
import { ResourceVariantsManager } from "@/components/resource-variants-manager";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { getResourceRecordByReference } from "@/lib/access-control";
import { organizationPath } from "@/lib/organization-path";
import { primaryResourceReference } from "@/lib/resource-slug-contract";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default async function InventoryItemPage({ params }: Props) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  const resource = identity
    ? await getResourceRecordByReference(id, identity.organizationId)
    : null;
  if (identity && resource) {
    const primaryReference = primaryResourceReference(resource);
    if (id !== primaryReference) {
      redirect(
        organizationPath(
          identity.organization.slug,
          `/inventory/${primaryReference}`,
        ),
      );
    }
  }
  const resourceId = resource?.id ?? id;
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
  const isPlace = resource?.type === "place";

  return (
    <>
      <ResourceDetails
        resourceId={resourceId}
        canEdit={canEdit}
        canDelete={canDelete}
        canShare={canShare}
        canViewStock={canViewStock}
        developerMode={identity?.developerMode ?? false}
        organizationId={identity?.organizationId ?? ""}
      />
      {resource ? (
        <ResourceComments resourceId={resourceId} canComment={canEdit} />
      ) : null}
      {resource ? (
        <ResourceConnectionDiagram
          canEdit={canEdit}
          canCreate={canCreate}
          canViewStock={canViewStock}
          resource={{
            id: resource.id,
            name: resource.name,
            type: resource.type,
            status: resource.status,
          }}
        />
      ) : null}
      {!isPlace ? (
        <ResourceVariantsManager
          resourceId={resourceId}
          canEdit={canEdit}
          canManageStock={canManageStock}
          hideWhenEmpty
          allowCreate={false}
        />
      ) : null}
      {canViewAssignments && !isPlace ? (
        <ResourceAssignmentsManager
          resourceId={resourceId}
          canEdit={canManageAssignments}
        />
      ) : null}
    </>
  );
}
