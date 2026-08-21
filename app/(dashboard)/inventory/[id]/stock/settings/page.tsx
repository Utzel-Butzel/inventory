import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ResourceStockSettings } from "@/components/resource-stock-settings";
import { getResourceRecordByReference } from "@/lib/access-control";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { getT } from "@/lib/ui-i18n/server";
import { primaryResourceReference } from "@/lib/resource-slug-contract";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("stock");
  return { title: t("resource.settings.title") };
}

export default async function StockSettingsPage({ params }: Props) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");

  const resource = await getResourceRecordByReference(
    id,
    identity.organizationId,
  );
  if (
    !resource ||
    !(await canAccessResource(identity, "stock.manage", resource))
  ) {
    redirect(organizationPath(identity.organization.slug, `/inventory/${id}/stock`));
  }
  const primaryReference = primaryResourceReference(resource);
  if (id !== primaryReference) {
    redirect(
      organizationPath(
        identity.organization.slug,
        `/inventory/${primaryReference}/stock/settings`,
      ),
    );
  }

  return <ResourceStockSettings resourceId={resource.id} />;
}
