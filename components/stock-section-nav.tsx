"use client";

import Link from "next/link";
import { Boxes, QrCode, Workflow } from "lucide-react";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui";

const stockSections = [
  { href: "/stock", label: "Overview", icon: Boxes },
  { href: "/stock/scan", label: "Scan", icon: QrCode },
  { href: "/stock/workflows", label: "Workflows", icon: Workflow },
] as const;

export function StockSectionNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Stock sections"
      className="mb-6 overflow-x-auto rounded-2xl border border-[#e4e7eb] bg-white p-1.5 shadow-[var(--shadow-sm)]"
    >
      <div className="grid min-w-[390px] grid-cols-3 gap-1">
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
                  ? "bg-[#eeedff] text-[#5147d9] shadow-sm"
                  : "text-[#6d7480] hover:bg-[#f5f6f8] hover:text-[#34383e]",
              )}
            >
              <Icon
                className={cn("size-4", active ? "text-[#635bff]" : "text-[#9298a2]")}
                aria-hidden="true"
              />
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
