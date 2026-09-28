import type { ClientResource } from "@/lib/client-types";
import { resourceShortCode, resourceShortUrl } from "@/lib/resource-short-link";

export type LabelStockUnit = {
  id: string;
  code: string;
  location: string | null;
};

export type LabelResource = Pick<
  ClientResource,
  "id" | "name" | "sku" | "barcode" | "location" | "type" | "quantity" | "cover"
> & { stockUnit?: LabelStockUnit };

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
