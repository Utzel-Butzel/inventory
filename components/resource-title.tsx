import type { ResourceTitleSource } from "@/lib/resource-title";

/** Shared inline title for inventory entries, including their optional subtitle. */
export function ResourceTitle({ resource }: { resource: ResourceTitleSource }) {
  const subtitle = resource.subtitle?.trim();
  return (
    <>
      {subtitle ? <><strong className="font-bold">{subtitle}</strong>{" "}</> : null}
      {resource.name}
    </>
  );
}
