"use client";

import {
  OrganizationLink as Link,
  useOrganizationPathname,
  useOrganizationReadOnly,
} from "@/components/organization-routing";
import { useT } from "next-i18next/client";
import {
  Bell,
  Braces,
  Building2,
  Boxes,
  ChevronDown,
  DatabaseZap,
  KeyRound,
  Languages,
  Share2,
  ShieldCheck,
  ShieldPlus,
  ShoppingBag,
  UserRound,
  Users,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/components/ui";
import type { AppPermission } from "@/lib/access-control-contract";

type SettingsNavigationItem = {
  labelKey: string;
  descriptionKey: string;
  href: string;
  activeHrefs?: string[];
  icon: LucideIcon;
  requiredPermission?: AppPermission;
  superadminOnly?: boolean;
};

const navigationGroups: Array<{
  labelKey: string;
  items: SettingsNavigationItem[];
}> = [
  {
    labelKey: "settings.groups.general",
    items: [
      {
        labelKey: "settings.items.user.label",
        descriptionKey: "settings.items.user.description",
        href: "/settings/user",
        icon: UserRound,
      },
      {
        labelKey: "settings.items.organization.label",
        descriptionKey: "settings.items.organization.description",
        href: "/settings/organization",
        icon: Building2,
      },
      {
        labelKey: "settings.items.systemOrganizations.label",
        descriptionKey: "settings.items.systemOrganizations.description",
        href: "/settings/system-organizations",
        icon: ShieldPlus,
        superadminOnly: true,
      },
      {
        labelKey: "settings.items.notifications.label",
        descriptionKey: "settings.items.notifications.description",
        href: "/settings/notifications",
        activeHrefs: ["/notifications"],
        icon: Bell,
      },
    ],
  },
  {
    labelKey: "settings.groups.inventory",
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
    ],
  },
  {
    labelKey: "settings.groups.peopleAccess",
    items: [
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
    labelKey: "settings.groups.automations",
    items: [
      {
        labelKey: "settings.items.actionFlows.label",
        descriptionKey: "settings.items.actionFlows.description",
        href: "/settings/action-flows",
        icon: Workflow,
        requiredPermission: "workflows.read",
      },
    ],
  },
  {
    labelKey: "settings.groups.integrationsAdvanced",
    items: [
      {
        labelKey: "settings.items.woocommerce.label",
        descriptionKey: "settings.items.woocommerce.description",
        href: "/settings/woocommerce",
        icon: ShoppingBag,
        requiredPermission: "webhooks.manage",
      },
      {
        labelKey: "settings.items.webhooks.label",
        descriptionKey: "settings.items.webhooks.description",
        href: "/settings/webhooks",
        icon: Webhook,
        requiredPermission: "webhooks.manage",
      },
      {
        labelKey: "settings.items.api.label",
        descriptionKey: "settings.items.api.description",
        href: "/settings/api",
        icon: KeyRound,
      },
    ],
  },
];

function isActive(pathname: string, item: SettingsNavigationItem) {
  return [item.href, ...(item.activeHrefs ?? [])].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}

export function SettingsNavigation({
  isSuperAdmin,
  permissions,
}: {
  isSuperAdmin: boolean;
  permissions: AppPermission[];
}) {
  const pathname = useOrganizationPathname();
  const isReadOnly = useOrganizationReadOnly();
  const { t } = useT("shell");
  const visibleGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.superadminOnly || isSuperAdmin) &&
          (!item.requiredPermission || permissions.includes(item.requiredPermission)),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const visibleItems = visibleGroups.flatMap((group) => group.items);
  const activeItem =
    visibleItems.find((item) => isActive(pathname, item)) ?? visibleItems[0];

  return (
    <>
      <aside className="hidden border-r border-border bg-surface xl:block">
        <div
          className={cn(
            "scrollbar-thin sticky overflow-y-auto px-4 py-7",
            isReadOnly
              ? "top-[109px] h-[calc(100dvh-109px)]"
              : "top-[68px] h-[calc(100dvh-68px)]",
          )}
        >
          <nav
            className="space-y-6"
            aria-label={t("settings.navigationLabel")}
          >
            {visibleGroups.map((group) => (
              <div key={group.labelKey}>
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  {t(group.labelKey)}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group flex min-h-10 items-center gap-3 rounded-xl px-2.5 py-2 transition",
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
                        <span className="min-w-0 truncate text-[13px] font-semibold">
                          {t(item.labelKey)}
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

      <div className="border-b border-border bg-surface px-4 py-3 xl:hidden">
        <details className="group relative">
          <summary className="flex h-10 cursor-pointer list-none items-center justify-between rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            <span className="truncate">
              {activeItem ? t(activeItem.labelKey) : t("settings.title")}
            </span>
            <ChevronDown
              className="size-4 shrink-0 text-muted transition group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <nav
            className="absolute inset-x-0 top-full z-20 mt-2 max-h-[min(65dvh,32rem)] space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl"
            aria-label={t("settings.navigationLabel")}
          >
            {visibleGroups.map((group) => (
              <div key={group.labelKey}>
                <p className="px-2 py-1 text-[11px] font-semibold text-muted">
                  {t(group.labelKey)}
                </p>
                {group.items.map((item) => {
                  const active = isActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={(event) =>
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open")
                      }
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium",
                        active
                          ? "bg-brand-soft text-brand"
                          : "text-foreground hover:bg-surface-muted",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {t(item.labelKey)}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </details>
      </div>
    </>
  );
}
