import { ResourceEditor } from "@/components/resource-editor";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { getResourceRecord } from "@/lib/access-control";
import { organizationPath } from "@/lib/organization-path";
import { getResourceVariantContext } from "@/lib/resource-families";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default async function EditInventoryItemPage({ params }: Props) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  const resource = await getResourceRecord(id, identity.organizationId);

  if (
    !resource ||
    !(await canAccessResource(identity, "inventory.update", resource))
  ) {
    redirect(organizationPath(identity.organization.slug, `/inventory/${id}`));
  }

  const [canDelete, canUseAi, canManageSpatial, rawVariantContext] = await Promise.all([
    canAccessResource(identity, "inventory.delete", resource),
    canAccessResource(identity, "ai.use", resource),
    canAccessResource(identity, "spatial.manage", resource),
    getResourceVariantContext(identity.organizationId, id),
  ]);
  const variantContext =
    rawVariantContext &&
    (await canAccessResource(
      identity,
      "inventory.read",
      rawVariantContext.primary,
    ))
      ? {
          primaryResourceId: rawVariantContext.primary.id,
          primaryName: rawVariantContext.primary.name,
          overriddenFields: rawVariantContext.overriddenFields,
        }
      : null;

  return (
    <ResourceEditor
      resourceId={id}
      canDelete={canDelete}
      canViewStock={identity.permissions.includes("stock.read")}
      canUseAi={canUseAi}
      canManageSpatial={canManageSpatial}
      variantContext={variantContext}
    />
  );
}
