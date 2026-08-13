"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "next-i18next/client";
import {
  Braces,
  Boxes,
  DatabaseZap,
  KeyRound,
  Languages,
  Share2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/components/ui";
import type { AppPermission } from "@/lib/access-control-contract";

type SettingsNavigationItem = {
  labelKey: string;
  descriptionKey: string;
  href: string;
  icon: LucideIcon;
  requiredPermission?: AppPermission;
};

const navigationGroups: Array<{
  labelKey: string;
  items: SettingsNavigationItem[];
}> = [
  {
    labelKey: "settings.groups.workspace",
    items: [
      {
        labelKey: "settings.items.data.label",
        descriptionKey: "settings.items.data.description",
        href: "/settings/data",
        icon: DatabaseZap,
      },
      {
        labelKey: "settings.items.languages.label",
        descriptionKey: "settings.items.languages.description",
        href: "/settings/languages",
        icon: Languages,
        requiredPermission: "settings.languages.manage",
      },
      {
        labelKey: "settings.items.inventoryTypes.label",
        descriptionKey: "settings.items.inventoryTypes.description",
        href: "/settings/inventory-types",
        icon: Boxes,
        requiredPermission: "settings.inventory-types.manage",
      },
      {
        labelKey: "settings.items.customFields.label",
        descriptionKey: "settings.items.customFields.description",
        href: "/settings/custom-fields",
        icon: Braces,
        requiredPermission: "settings.custom-fields.manage",
      },
      {
        labelKey: "settings.items.users.label",
        descriptionKey: "settings.items.users.description",
        href: "/settings/users",
        icon: Users,
        requiredPermission: "users.manage",
      },
      {
        labelKey: "settings.items.access.label",
        descriptionKey: "settings.items.access.description",
        href: "/settings/access",
        icon: ShieldCheck,
        requiredPermission: "roles.manage",
      },
      {
        labelKey: "settings.items.sharing.label",
        descriptionKey: "settings.items.sharing.description",
        href: "/settings/sharing",
        icon: Share2,
        requiredPermission: "sharing.manage",
      },
    ],
  },
  {
    labelKey: "settings.groups.developer",
    items: [
      {
        labelKey: "settings.items.api.label",
        descriptionKey: "settings.items.api.description",
        href: "/settings/api",
        icon: KeyRound,
      },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SettingsNavigation({
  permissions,
}: {
  permissions: AppPermission[];
}) {
  const pathname = usePathname();
  const { t } = useT("shell");
  const visibleGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.requiredPermission || permissions.includes(item.requiredPermission),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const visibleItems = visibleGroups.flatMap((group) => group.items);

  return (
    <>
      <aside className="hidden border-r border-border bg-surface md:block">
        <div className="scrollbar-thin sticky top-[68px] h-[calc(100dvh-68px)] overflow-y-auto px-4 py-7">
          <div className="px-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">
              {t("settings.eyebrow")}
            </p>
            <p className="mt-1.5 text-xl font-semibold tracking-[-0.025em] text-foreground">
              {t("settings.title")}
            </p>
            <p className="mt-2 text-[12px] leading-5 text-muted">
              {t("settings.description")}
            </p>
          </div>

          <nav
            className="mt-7 space-y-6"
            aria-label={t("settings.navigationLabel")}
          >
            {visibleGroups.map((group) => (
              <div key={group.labelKey}>
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  {t(group.labelKey)}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition",
                          active
                            ? "bg-brand-soft text-brand"
                            : "text-foreground hover:bg-surface-hover",
                        )}
                      >
                        <Icon
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            active
                              ? "text-brand"
                              : "text-muted group-hover:text-muted-strong",
                          )}
                          strokeWidth={active ? 2.2 : 1.9}
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold">
                            {t(item.labelKey)}
                          </span>
                          <span
                            className={cn(
                              "mt-0.5 block text-[10px] leading-4",
                              active ? "text-brand" : "text-muted",
                            )}
                          >
                            {t(item.descriptionKey)}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className="border-b border-border bg-surface px-4 py-3 md:hidden">
        <nav
          className="scrollbar-thin flex gap-1 overflow-x-auto"
          aria-label={t("settings.navigationLabel")}
        >
          {visibleItems.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[12px] font-semibold transition",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-muted-strong hover:bg-surface-muted hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
