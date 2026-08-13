"use client";

import {
  OrganizationLink as Link,
  useOrganizationPathname,
} from "@/components/organization-routing";
import { Boxes, QrCode, ShoppingCart, Workflow } from "lucide-react";
import { useT } from "next-i18next/client";

import { cn } from "@/components/ui";

const stockSections = [
  { href: "/stock", labelKey: "nav.overview", icon: Boxes },
  { href: "/stock/orders", labelKey: "nav.orders", icon: ShoppingCart },
  { href: "/stock/scan", labelKey: "nav.scan", icon: QrCode },
  { href: "/stock/workflows", labelKey: "nav.workflows", icon: Workflow },
] as const;

export function StockSectionNav() {
  const pathname = useOrganizationPathname();
  const { t } = useT("stock");

  return (
    <nav
      aria-label={t("nav.label")}
      className="mb-6 overflow-x-auto rounded-2xl border border-border bg-surface p-1.5 shadow-[var(--shadow-sm)]"
    >
      <div className="grid min-w-[500px] grid-cols-4 gap-1">
        {stockSections.map((section) => {
          const active =
            section.href === "/stock"
              ? pathname === section.href
              : pathname === section.href || pathname.startsWith(`${section.href}/`);
          const Icon = section.icon;

          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-[12px] font-semibold transition",
                active
                  ? "bg-brand-soft text-brand shadow-sm"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon
                className={cn("size-4", active ? "text-brand" : "text-muted")}
                aria-hidden="true"
              />
              {t(section.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
