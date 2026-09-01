import { redirect } from "next/navigation";

import { getResourceRecordByReference } from "@/lib/access-control";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { primaryResourceReference } from "@/lib/resource-slug-contract";

type Props = { params: Promise<{ id: string }> };

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
  redirect(
    organizationPath(
      identity.organization.slug,
      `/inventory/${primaryReference}/edit#stock-settings`,
    ),
  );
}
