import type { Metadata } from "next";

import { ResourceStockManager } from "@/components/resource-stock-manager";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { getResourceRecord } from "@/lib/access-control";
import { getT } from "@/lib/ui-i18n/server";

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
    ? await getResourceRecord(id, identity.organizationId)
    : null;
  const canManageStock =
    identity && resource
      ? await canAccessResource(identity, "stock.manage", resource)
      : false;
  return (
    <ResourceStockManager
      resourceId={id}
      canEdit={canManageStock}
    />
  );
}
