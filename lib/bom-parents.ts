export type BomParentOrigin = "local" | "inherited" | "override" | "variant";
export type BomParentQuantityUnit = "base" | "purchase";

export type BomParent = {
  id: string;
  slotKey: string;
  resourceId: string;
  name: string;
  type: string;
  status: string;
  quantityPerAssembly: number;
  quantityUnit: BomParentQuantityUnit;
  unitName: string;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number | null;
  position: number;
  note: string;
  origin: BomParentOrigin;
};

export type BomParentReference = Omit<
  BomParent,
  "name" | "type" | "status" | "unitName" | "purchaseUnitName" | "purchaseUnitFactor"
>;

type BomParentBaseRow = {
  id: string;
  slotKey: string;
  assemblyResourceId: string;
  quantityPerAssembly: number;
  quantityUnit?: BomParentQuantityUnit;
  position: number;
  note: string;
};

type MatchingBomParentOverrideRow = {
  id: string;
  slotKey: string;
  variantResourceId: string;
  quantityPerAssembly: number | null;
  quantityUnit?: BomParentQuantityUnit | null;
  position: number | null;
  note: string;
};

type BomParentVariantLink = {
  variantResourceId: string;
  primaryResourceId: string;
};

type BomParentOverrideRow = MatchingBomParentOverrideRow & {
  componentResourceId: string | null;
  removed: boolean;
};

export function resolveBomParentReferences(input: {
  componentResourceId: string;
  baseRows: BomParentBaseRow[];
  matchingOverrideRows: MatchingBomParentOverrideRow[];
  variantLinks: BomParentVariantLink[];
  inheritedOverrides: BomParentOverrideRow[];
}): BomParentReference[] {
  const primaryByVariant = new Map(
    input.variantLinks.map((link) => [
      link.variantResourceId,
      link.primaryResourceId,
    ]),
  );
  const variantsByPrimary = new Map<string, string[]>();
  for (const link of input.variantLinks) {
    const variants = variantsByPrimary.get(link.primaryResourceId) ?? [];
    variants.push(link.variantResourceId);
    variantsByPrimary.set(link.primaryResourceId, variants);
  }
  const overrideByVariantSlot = new Map(
    input.inheritedOverrides.map((row) => [
      `${row.variantResourceId}:${row.slotKey}`,
      row,
    ]),
  );
  const references = new Map<string, BomParentReference>();

  for (const row of input.baseRows) {
    if (primaryByVariant.has(row.assemblyResourceId)) continue;
    references.set(row.assemblyResourceId, {
      id: row.id,
      slotKey: row.slotKey,
      resourceId: row.assemblyResourceId,
      quantityPerAssembly: row.quantityPerAssembly,
      quantityUnit: row.quantityUnit ?? "base",
      position: row.position,
      note: row.note,
      origin: "local",
    });
    for (const variantResourceId of
      variantsByPrimary.get(row.assemblyResourceId) ?? []) {
      const override = overrideByVariantSlot.get(
        `${variantResourceId}:${row.slotKey}`,
      );
      if (override) {
        if (
          override.removed ||
          override.componentResourceId !== input.componentResourceId ||
          override.quantityPerAssembly === null ||
          override.position === null
        ) {
          continue;
        }
        references.set(variantResourceId, {
          id: override.id,
          slotKey: override.slotKey,
          resourceId: variantResourceId,
          quantityPerAssembly: override.quantityPerAssembly,
          quantityUnit: override.quantityUnit ?? "base",
          position: override.position,
          note: override.note,
          origin: "override",
        });
        continue;
      }
      references.set(variantResourceId, {
        id: `inherited:${variantResourceId}:${row.slotKey}`,
        slotKey: row.slotKey,
        resourceId: variantResourceId,
        quantityPerAssembly: row.quantityPerAssembly,
        quantityUnit: row.quantityUnit ?? "base",
        position: row.position,
        note: row.note,
        origin: "inherited",
      });
    }
  }

  for (const row of input.matchingOverrideRows) {
    if (
      !primaryByVariant.has(row.variantResourceId) ||
      row.quantityPerAssembly === null ||
      row.position === null
    ) {
      continue;
    }
    references.set(row.variantResourceId, {
      id: row.id,
      slotKey: row.slotKey,
      resourceId: row.variantResourceId,
      quantityPerAssembly: row.quantityPerAssembly,
      quantityUnit: row.quantityUnit ?? "base",
      position: row.position,
      note: row.note,
      origin: "override",
    });
  }

  return Array.from(references.values());
}
