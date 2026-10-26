export type ResourceTitleSource = { name: string; subtitle?: string | null };

export function resourceTitleText(resource: ResourceTitleSource) {
  return [resource.subtitle?.trim(), resource.name].filter(Boolean).join(" ");
}
