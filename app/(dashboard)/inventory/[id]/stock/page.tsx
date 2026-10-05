import { parseStockBookingTask } from "@/components/resource-stock/movement-form";
import type { Metadata } from "next";

import { InventoryBreadcrumb } from "@/components/inventory-breadcrumb-context";
import { ResourceStockManager } from "@/components/resource-stock-manager";
import { canAccessResource, getSessionIdentity } from "@/lib/api-auth";
import { getResourceRecordByReference } from "@/lib/access-control";
import { getT } from "@/lib/ui-i18n/server";
import { organizationPath } from "@/lib/organization-path";
import { primaryResourceReference } from "@/lib/resource-slug-contract";
import { isResourceId } from "@/lib/resource-short-link";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("stock");

  return {
    title: t("resource.metadata.title"),
  };
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ unit?: string | string[]; task?: string | string[] }>;
};

export default async function ResourceStockPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { unit, task } = await searchParams;
  const initialTask = parseStockBookingTask(task);
  const query = new URLSearchParams();
  if (typeof task === "string") query.set("task", initialTask);
  const selectedUnitId = typeof unit === "string" && isResourceId(unit) ? unit.toLowerCase() : undefined;
  if (selectedUnitId) query.set("unit", selectedUnitId);
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
          `/inventory/${primaryReference}/stock${query.size ? `?${query}` : ""}`,
        ),
      );
    }
  }
  const canManageStock =
    identity && resource
      ? await canAccessResource(identity, "stock.manage", resource)
      : false;
  const resourceReference = resource ? primaryResourceReference(resource) : id;
  return (
    <>
      {resource ? (
        <InventoryBreadcrumb
          href={`/inventory/${resourceReference}`}
          name={resource.name}
        />
      ) : null}
      <ResourceStockManager
        resourceId={resource?.id ?? id}
        canEdit={canManageStock}
        initialTask={initialTask}
        key={`${resource?.id ?? id}:${initialTask}`}
        selectedUnitId={selectedUnitId}
      />
    </>
  );
}
