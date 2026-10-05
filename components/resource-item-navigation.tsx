"use client";

import { useT } from "next-i18next/client";
import { OrganizationLink as Link } from "@/components/organization-routing";

export function ResourceItemNavigation({ resourceId, current, canViewStock = true }: {
  resourceId: string;
  current: "details" | "stock";
  canViewStock?: boolean;
}) {
  const { t } = useT("inventory");
  return (
    <nav aria-label={t("workspace.itemNavigation")} className="mb-5 flex gap-1 border-b border-border">
      {(["details", ...(canViewStock ? ["stock"] : [])] as const).map((page) => (
        <Link key={page} href={`/inventory/${resourceId}${page === "stock" ? "/stock" : ""}`}
          aria-current={current === page ? "page" : undefined}
          className={`border-b-2 px-4 py-3 text-sm font-semibold transition ${current === page ? "border-brand text-brand" : "border-transparent text-muted hover:text-foreground"}`}>
          {t(`workspace.${page}`)}
        </Link>
      ))}
    </nav>
  );
}
