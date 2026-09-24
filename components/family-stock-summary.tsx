"use client";

import { useT } from "next-i18next/client";
import { OrganizationLink as Link } from "@/components/organization-routing";

export type FamilyStock = {
  primary: { id: string; name: string; quantity: number };
  variants: Array<{ id: string; name: string; quantity: number }>;
  summary: {
    totalQuantity: number;
    primaryQuantity: number;
    variantQuantity: number;
  };
};

export function FamilyStockSummary({
  family,
  showVariants = true,
}: {
  family: FamilyStock;
  showVariants?: boolean;
}) {
  const { t, i18n } = useT("inventory");
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language);
  if (!family.variants.length) return null;
  return (
    <section
      className="rounded-xl border border-border bg-surface p-4"
      aria-label={t("family.stock.title")}
    >
      <h3 className="text-sm font-semibold">{t("family.stock.title")}</h3>
      <dl className="mt-3 space-y-2 text-sm">
        {showVariants &&
          family.variants.map((variant) => (
            <div key={variant.id} className="flex justify-between gap-4">
              <dt>
                <Link
                  href={`/inventory/${variant.id}/stock`}
                  className="hover:underline"
                >
                  {variant.name}
                </Link>
              </dt>
              <dd className="tabular-nums">
                {number.format(variant.quantity)}
              </dd>
            </div>
          ))}
        <div className="flex justify-between gap-4 text-muted">
          <dt>{t("family.stock.unassigned")}</dt>
          <dd className="tabular-nums">
            {number.format(family.summary.primaryQuantity)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-2 font-semibold">
          <dt>{t("family.stock.total")}</dt>
          <dd className="tabular-nums">
            {number.format(family.summary.totalQuantity)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
