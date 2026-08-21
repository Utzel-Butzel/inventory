"use client";

import { CalendarDays, ClipboardList } from "lucide-react";
import { useT } from "next-i18next/client";

import {
  OrganizationLink as Link,
  useOrganizationPathname,
} from "@/components/organization-routing";
import { cn } from "@/components/ui";

const sections = [
  { href: "/requests", labelKey: "nav.requests", icon: ClipboardList },
  { href: "/requests/calendar", labelKey: "nav.calendar", icon: CalendarDays },
] as const;

export function RequestSectionNav() {
  const pathname = useOrganizationPathname();
  const { t } = useT("requests");

  return (
    <nav
      aria-label={t("nav.label")}
      className="mb-6 rounded-xl border border-border bg-surface p-1.5"
    >
      <div className="grid grid-cols-2 gap-1">
        {sections.map((section) => {
          const active =
            section.href === "/requests"
              ? pathname === section.href
              : pathname === section.href || pathname.startsWith(`${section.href}/`);
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition",
                active
                  ? "bg-brand-soft text-brand"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {t(section.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
