import { ResourceEditor } from "@/components/resource-editor";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { getResourceRecordByReference } from "@/lib/access-control";
import { organizationPath } from "@/lib/organization-path";
import { getResourceVariantContext } from "@/lib/resource-families";
import { primaryResourceReference } from "@/lib/resource-slug-contract";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default async function EditInventoryItemPage({ params }: Props) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  const resource = await getResourceRecordByReference(
    id,
    identity.organizationId,
  );

  if (
    !resource ||
    !(await canAccessResource(identity, "inventory.update", resource))
  ) {
    redirect(organizationPath(identity.organization.slug, `/inventory/${id}`));
  }
  const primaryReference = primaryResourceReference(resource);
  if (id !== primaryReference) {
    redirect(
      organizationPath(
        identity.organization.slug,
        `/inventory/${primaryReference}/edit`,
      ),
    );
  }

  const [canDelete, canUseAi, canManageSpatial, rawVariantContext] = await Promise.all([
    canAccessResource(identity, "inventory.delete", resource),
    canAccessResource(identity, "ai.use", resource),
    canAccessResource(identity, "spatial.manage", resource),
    getResourceVariantContext(identity.organizationId, resource.id),
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
      resourceId={resource.id}
      canDelete={canDelete}
      canViewStock={identity.permissions.includes("stock.read")}
      canUseAi={canUseAi}
      canManageSpatial={canManageSpatial}
      variantContext={variantContext}
    />
  );
}
