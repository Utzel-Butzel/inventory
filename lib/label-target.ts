import type { ClientResource } from "@/lib/client-types";
import { resourceShortCode, resourceShortUrl } from "@/lib/resource-short-link";

export type LabelStockUnit = {
  id: string;
  code: string;
  location: string | null;
};

export type LabelResource = Pick<
  ClientResource,
  "id" | "name" | "sku" | "barcode" | "location" | "type" | "quantity"
> & { cover: { url: string; altText: string } | null; subtitle?: string; stockUnit?: LabelStockUnit };

export type LabelTextOverride = { name?: string; subtitle?: string };

// Print-only copies preserve identity, QR target and stock-unit information.
export const applyLabelTextOverride = (resource: LabelResource, override?: LabelTextOverride): LabelResource => ({
  ...resource,
  name: override?.name ?? resource.name,
  subtitle: override?.subtitle ?? resource.subtitle ?? "",
});

export const labelTargetKey = (resource: LabelResource) =>
  resource.stockUnit ? `${resource.id}:${resource.stockUnit.id}` : resource.id;

export const labelTargetName = (resource: LabelResource) =>
  resource.stockUnit
    ? `${resource.name} · ${resource.stockUnit.code}`
    : resource.name;

export const labelTargetUrl = (origin: string, resource: LabelResource) => {
  const url = resourceShortUrl(origin, resource.id);
  return resource.stockUnit
    ? `${url}?unit=${resourceShortCode(resource.stockUnit.id)}`
    : url;
};
