import type { Metadata } from "next";

import { ResourceStockManager } from "@/components/resource-stock-manager";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { getResourceRecordByReference } from "@/lib/access-control";
import { getT } from "@/lib/ui-i18n/server";
import { organizationPath } from "@/lib/organization-path";
import { primaryResourceReference } from "@/lib/resource-slug-contract";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("stock");

  return {
    title: t("resource.metadata.title"),
  };
}

type Props = { params: Promise<{ id: string }> };

export default async function ResourceStockPage({ params }: Props) {
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
          `/inventory/${primaryReference}/stock`,
        ),
      );
    }
  }
  const canManageStock =
    identity && resource
      ? await canAccessResource(identity, "stock.manage", resource)
      : false;
  return (
    <ResourceStockManager
      resourceId={resource?.id ?? id}
      canEdit={canManageStock}
    />
  );
}
