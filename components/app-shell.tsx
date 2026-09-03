"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useT } from "next-i18next/client";
import {
  ArrowRight,
  Camera,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MapPinned,
  Menu,
  PackageOpen,
  Plus,
  Search,
  Settings,
  Warehouse,
  X,
} from "lucide-react";

import { NotificationBell } from "@/components/notification-bell";
import {
  InventoryBreadcrumbProvider,
  type InventoryBreadcrumbItem,
} from "@/components/inventory-breadcrumb-context";
import { OfflineSupportProvider } from "@/components/offline-support";
import {
  OrganizationLink as Link,
  OrganizationRoutingProvider,
} from "@/components/organization-routing";
import {
  OrganizationSwitcher,
  type ActiveOrganization,
  type OrganizationMembershipSummary,
} from "@/components/organization-switcher";
import { cn } from "@/components/ui";
import { BrandMark } from "@/components/brand-mark";
import type { UserRole } from "@/db/schema";
import type { ApiScope, AppPermission } from "@/lib/access-control-contract";
import { disableOfflineModeBeforeSignOut } from "@/lib/offline-support-client";
import {
  organizationPath,
  stripOrganizationPathname,
} from "@/lib/organization-path";

type ShellUser = {
  name?: string | null;
  email?: string | null;
  role: UserRole;
  roleName: string;
  permissions: AppPermission[];
  scopes: ApiScope[];
};

type NavigationChild = {
  labelKey: string;
  href: string;
  permission?: AppPermission;
};

type NavigationItem = {
  labelKey: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission?: AppPermission;
  activeHrefs?: string[];
  children?: NavigationChild[];
};

const navigation: NavigationItem[] = [
  {
    labelKey: "navigation.overview",
    href: "/dashboard",
    icon: LayoutDashboard,
    permission: "inventory.read",
  },
  {
    labelKey: "navigation.inventory",
    href: "/inventory",
    icon: PackageOpen,
    permission: "inventory.read",
    activeHrefs: ["/inventory", "/labels", "/duplicates", "/batch"],
    children: [
      {
        labelKey: "navigation.entries",
        href: "/inventory",
        permission: "inventory.read",
      },
      {
        labelKey: "navigation.favorites",
        href: "/inventory/favorites",
        permission: "inventory.read",
      },
      {
        labelKey: "navigation.labels",
        href: "/labels",
        permission: "labels.read",
      },
      {
        labelKey: "navigation.duplicates",
        href: "/duplicates",
        permission: "inventory.read",
      },
    ],
  },
  {
    labelKey: "navigation.stock",
    href: "/stock",
    icon: Warehouse,
    permission: "stock.read",
    children: [
      {
        labelKey: "navigation.stockOverview",
        href: "/stock",
        permission: "stock.read",
      },
      {
        labelKey: "navigation.stockScan",
        href: "/stock/scan",
        permission: "workflows.read",
      },
    ],
  },
  {
    labelKey: "navigation.operations",
    href: "/operations/purchases",
    icon: ClipboardList,
    permission: "orders.read",
    activeHrefs: ["/operations", "/requests", "/contacts"],
    children: [
      {
        labelKey: "navigation.purchases",
        href: "/operations/purchases",
        permission: "orders.read",
      },
      {
        labelKey: "navigation.sales",
        href: "/operations/sales",
        permission: "orders.read",
      },
      {
        labelKey: "navigation.loans",
        href: "/operations/loans",
        permission: "orders.read",
      },
      {
        labelKey: "navigation.requests",
        href: "/requests",
        permission: "requests.read",
      },
      {
        labelKey: "navigation.reservationCalendar",
        href: "/requests/calendar",
        permission: "requests.read",
      },
      {
        labelKey: "navigation.contacts",
        href: "/contacts",
        permission: "contacts.read",
      },
    ],
  },
  {
    labelKey: "navigation.locations",
    href: "/map",
    icon: MapPinned,
    permission: "spatial.read",
    activeHrefs: ["/map", "/spaces"],
    children: [
      {
        labelKey: "navigation.map",
        href: "/map",
        permission: "spatial.read",
      },
      {
        labelKey: "navigation.rooms",
        href: "/spaces",
        permission: "spatial.read",
      },
    ],
  },
];

const pageNames: Record<string, string> = {
  dashboard: "navigation.overview",
  inventory: "navigation.inventory",
  favorites: "navigation.favorites",
  stock: "navigation.stock",
  operations: "navigation.operations",
  locations: "navigation.locations",
  batch: "actions.photoCapture",
  labels: "navigation.labels",
  duplicates: "navigation.duplicates",
  notifications: "navigation.notifications",
  settings: "navigation.settings",
};

function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isNavigationItemActive(pathname: string, item: NavigationItem) {
  return (item.activeHrefs ?? [item.href]).some((href) =>
    isPathActive(pathname, href),
  );
}

const settingsPageNames: Record<string, string> = {
  user: "settings.items.user.label",
  organization: "settings.items.organization.label",
  "system-organizations": "settings.items.systemOrganizations.label",
  data: "settings.items.data.label",
  languages: "settings.items.languages.label",
  "inventory-types": "settings.items.inventoryTypes.label",
  "custom-fields": "settings.items.customFields.label",
  users: "settings.items.users.label",
  access: "settings.items.access.label",
  sharing: "settings.items.sharing.label",
  notifications: "settings.items.notifications.label",
  "action-flows": "settings.items.actionFlows.label",
  woocommerce: "settings.items.woocommerce.label",
  webhooks: "settings.items.webhooks.label",
  api: "settings.items.api.label",
};

const SIDEBAR_EXPANDED_STORAGE_KEY = "open-inventory.sidebar.expanded";

function initials(
  name: string | null | undefined,
  email: string | null | undefined,
  fallback: string,
) {
  const source = name?.trim() || email?.split("@")[0] || fallback;
  const parts = source.split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`
      : source.slice(0, 2)
  ).toUpperCase();
}

function CreateMenu({
  user,
  onNavigate,
  variant = "sidebar",
}: {
  user: ShellUser;
  onNavigate?: () => void;
  variant?: "sidebar" | "compact";
}) {
  const { t } = useT("shell");
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuContainerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [open]);

  const canCreateInventory = user.permissions.includes("inventory.create");
  const canCreateRequest =
    user.permissions.includes("requests.create") &&
    user.permissions.includes("inventory.read");
  if (!canCreateInventory && !canCreateRequest) return null;

  const closeMenu = () => {
    setOpen(false);
    onNavigate?.();
  };

  return (
    <div
      ref={menuContainerRef}
      className={cn("relative", variant === "sidebar" && "px-3.5 pt-2")}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("actions.createMenu")}
        className={cn(
          "flex items-center justify-center rounded-xl bg-brand-solid font-semibold text-on-brand shadow-sm transition hover:bg-brand-hover active:bg-brand-active",
          variant === "compact"
            ? "size-11"
            : "h-10 w-full gap-2 px-3 text-[14px]",
        )}
      >
        <Plus className="size-4" strokeWidth={2.2} aria-hidden="true" />
        {variant === "sidebar" ? t("actions.new") : null}
      </button>

      {open ? (
        <div
          id={menuId}
          role="group"
          className={cn(
            "absolute top-full z-30 mt-2 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-xl",
            variant === "compact"
              ? "right-0 w-64"
              : "left-3.5 right-3.5",
          )}
          aria-label={t("actions.createMenu")}
        >
          {canCreateInventory ? (
            <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted">
              {t("actions.inventoryGroup")}
            </p>
          ) : null}
          {canCreateInventory ? (
            <Link
              href="/inventory/new"
              onClick={closeMenu}
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-foreground transition hover:bg-surface-muted"
            >
              <Plus className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">
                  {t("actions.manualEntry")}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                  {t("actions.manualEntryDescription")}
                </span>
              </span>
            </Link>
          ) : null}
          {canCreateInventory && user.scopes.includes("ai") ? (
            <Link
              href="/batch"
              onClick={closeMenu}
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-foreground transition hover:bg-surface-muted"
            >
              <Camera
                className="mt-0.5 size-4 shrink-0 text-brand"
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">
                  {t("actions.photoCapture")}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                  {t("actions.photoCaptureDescription")}
                </span>
              </span>
            </Link>
          ) : null}
          {canCreateRequest ? (
            <div
              className={cn(
                canCreateInventory && "mt-1 border-t border-border pt-1",
              )}
            >
              <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted">
                {t("actions.operationsGroup")}
              </p>
              <Link
                href="/requests"
                onClick={closeMenu}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-foreground transition hover:bg-surface-muted"
              >
                <ClipboardList
                  className="mt-0.5 size-4 shrink-0 text-brand"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">
                    {t("actions.internalRequest")}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                    {t("actions.internalRequestDescription")}
                  </span>
                </span>
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SidebarContent({
  pathname,
  user,
  organization,
  organizations,
  onNavigate,
  showCreateMenu = true,
}: {
  pathname: string;
  user: ShellUser;
  organization: ActiveOrganization;
  organizations: OrganizationMembershipSummary[];
  onNavigate?: () => void;
  showCreateMenu?: boolean;
}) {
  const { t } = useT(["shell", "common"]);
  const navigationIdPrefix = useId().replaceAll(":", "");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () =>
      new Set(
        navigation
          .filter(
            (item) =>
              item.children?.length && isNavigationItemActive(pathname, item),
          )
          .map((item) => item.href),
      ),
  );
  const [restoredExpansion, setRestoredExpansion] = useState(false);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(
        SIDEBAR_EXPANDED_STORAGE_KEY,
      );
      if (stored) {
        const restored = JSON.parse(stored);
        if (Array.isArray(restored)) {
          setExpandedGroups(
            (current) =>
              new Set([
                ...current,
                ...restored.filter((value): value is string =>
                  navigation.some((item) => item.href === value),
                ),
              ]),
          );
        }
      }
    } catch {
      // Keep the active group open when session storage is unavailable.
    } finally {
      setRestoredExpansion(true);
    }
  }, []);

  useEffect(() => {
    const activeGroup = navigation.find(
      (item) =>
        item.children?.length && isNavigationItemActive(pathname, item),
    );
    if (!activeGroup) return;
    setExpandedGroups((current) => {
      if (current.has(activeGroup.href)) return current;
      return new Set([...current, activeGroup.href]);
    });
  }, [pathname]);

  useEffect(() => {
    if (!restoredExpansion) return;
    try {
      window.sessionStorage.setItem(
        SIDEBAR_EXPANDED_STORAGE_KEY,
        JSON.stringify([...expandedGroups]),
      );
    } catch {
      // Expansion persistence is optional.
    }
  }, [expandedGroups, restoredExpansion]);

  const handleSignOut = async () => {
    try {
      await disableOfflineModeBeforeSignOut();
    } finally {
      await signOut({ redirectTo: "/login" });
    }
  };
  return (
    <div className="flex h-full flex-col bg-surface-subtle">
      <div className="flex h-[68px] items-center px-5">
        <Link
          href="/inventory"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg text-foreground"
        >
          <BrandMark className="size-8 shrink-0" aria-hidden="true" />
          <span className="text-[16px] font-semibold">
            {t("brand")}
          </span>
        </Link>
      </div>

      {organizations.length > 1 ? (
        <div className="px-3.5 pt-2">
          <OrganizationSwitcher
            organization={organization}
            organizations={organizations}
          />
        </div>
      ) : null}

      {showCreateMenu ? <CreateMenu user={user} onNavigate={onNavigate} /> : null}

      <nav
        className="scrollbar-thin mt-6 min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        aria-label={t("navigation.mainLabel")}
      >
        <p className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-sidebar-muted">
          {t("sections.workspace")}
        </p>
        <div className="space-y-0.5">
          {navigation
            .map((item) => ({
              ...item,
              visibleChildren: item.children?.filter(
                (child) =>
                  !child.permission || user.permissions.includes(child.permission),
              ),
            }))
            .filter(
              (item) =>
                !item.permission ||
                user.permissions.includes(item.permission) ||
                Boolean(item.visibleChildren?.length),
            )
            .map((item) => {
              const active = isNavigationItemActive(pathname, item);
              const visibleChildren = item.visibleChildren;
              const hasChildren = Boolean(visibleChildren?.length);
              const expanded = hasChildren && expandedGroups.has(item.href);
              const canOpenDefault =
                !item.permission || user.permissions.includes(item.permission);
              const targetHref = canOpenDefault
                ? item.href
                : (visibleChildren?.[0]?.href ?? item.href);
              const childrenId = `${navigationIdPrefix}-${item.labelKey.replaceAll(".", "-")}`;
              const activeChildHref = visibleChildren
                ?.filter((child) => isPathActive(pathname, child.href))
                .sort((left, right) => right.href.length - left.href.length)[0]
                ?.href;
              const Icon = item.icon;
              return (
                <div key={item.href} className="space-y-0.5">
                  <div
                    className={cn(
                      "group flex h-11 items-center rounded-xl text-[14px] font-medium transition lg:h-10",
                      active && !hasChildren && "bg-brand-soft text-brand",
                      active && hasChildren && "text-brand",
                      !active &&
                        "text-sidebar-muted-strong hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    <Link
                      href={targetHref}
                      onClick={onNavigate}
                      aria-current={active && !hasChildren ? "page" : undefined}
                      className="flex h-full min-w-0 flex-1 items-center gap-3 pl-2.5"
                    >
                      <Icon
                        className={cn(
                          "size-[17px] shrink-0",
                          active
                            ? "text-brand"
                            : "text-sidebar-muted group-hover:text-sidebar-muted-strong",
                        )}
                        strokeWidth={active ? 2.2 : 1.9}
                        aria-hidden="true"
                      />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </Link>
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGroups((current) => {
                            const next = new Set(current);
                            if (next.has(item.href)) next.delete(item.href);
                            else next.add(item.href);
                            return next;
                          })
                        }
                        aria-expanded={expanded}
                        aria-controls={childrenId}
                        aria-label={t(
                          expanded
                            ? "actions.collapseNavigationGroup"
                            : "actions.expandNavigationGroup",
                          { group: t(item.labelKey) },
                        )}
                        className="mr-1 grid size-11 shrink-0 place-items-center rounded-lg text-current transition hover:bg-surface-hover lg:size-8"
                      >
                        <ChevronDown
                          className={cn(
                            "size-3.5 transition-transform",
                            expanded && "rotate-180",
                          )}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                  </div>

                  {expanded && visibleChildren?.length ? (
                    <div
                      id={childrenId}
                      className="ml-[18px] space-y-0.5 border-l border-border pl-[18px]"
                    >
                      {visibleChildren.map((child) => {
                        const childActive = child.href === activeChildHref;
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={onNavigate}
                            aria-current={childActive ? "page" : undefined}
                            className={cn(
                              "flex min-h-11 items-center rounded-lg px-2 text-[13px] font-medium transition lg:min-h-8",
                              childActive
                                ? "bg-brand-soft text-brand"
                                : "text-sidebar-muted hover:bg-surface-muted hover:text-foreground",
                            )}
                          >
                            {t(child.labelKey)}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
      </nav>

      <div className="border-t border-border p-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={
            isPathActive(pathname, "/settings") || pathname === "/notifications"
              ? "page"
              : undefined
          }
          className={cn(
            "group mb-1 flex h-11 items-center gap-3 rounded-xl px-2.5 text-[14px] font-medium transition lg:h-10",
            isPathActive(pathname, "/settings") || pathname === "/notifications"
              ? "bg-brand-soft text-brand"
              : "text-sidebar-muted-strong hover:bg-surface-muted hover:text-foreground",
          )}
        >
          <Settings
            className={cn(
              "size-[17px] shrink-0",
              isPathActive(pathname, "/settings") || pathname === "/notifications"
                ? "text-brand"
                : "text-sidebar-muted group-hover:text-sidebar-muted-strong",
            )}
            aria-hidden="true"
          />
          {t("navigation.settings")}
        </Link>
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">
            {initials(user.name, user.email, t("user.generic"))}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-foreground">
              {user.name || t("user.fallbackName")}
            </p>
            <p className="truncate text-[11px] text-sidebar-muted">
              {user.email || t("user.signedIn")}
            </p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand">
              {user.roleName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-sidebar-muted transition hover:bg-surface-muted hover:text-foreground lg:size-8"
            aria-label={t("actions.signOut")}
            title={t("actions.signOut")}
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  offlineOwnerKey,
  user,
  organization,
  organizations,
  websiteUrl,
}: {
  children: React.ReactNode;
  offlineOwnerKey: string;
  user: ShellUser;
  organization: ActiveOrganization;
  organizations: OrganizationMembershipSummary[];
  websiteUrl: string;
}) {
  const pathname = usePathname();
  const scopedPathname = stripOrganizationPathname(pathname);
  const { t } = useT("shell");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [inventoryItemBreadcrumb, setInventoryItemBreadcrumb] =
    useState<InventoryBreadcrumbItem | null>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const pathSegments = scopedPathname.split("/").filter(Boolean);
  const section = pathSegments[0] ?? "inventory";
  const navigationSection =
    section === "notifications"
      ? "settings"
      : ["contacts", "requests"].includes(section)
        ? "operations"
        : ["map", "spaces"].includes(section)
          ? "locations"
          : section;
  const pageName = t(pageNames[navigationSection] ?? "navigation.inventory");
  const sectionHref =
    navigationSection === "operations"
      ? "/operations/purchases"
      : navigationSection === "locations"
        ? "/map"
        : `/${section}`;
  const settingsPageKey =
    section === "settings" && pathSegments[1]
      ? settingsPageNames[pathSegments[1]]
      : undefined;
  const settingsPageName =
    section === "notifications"
      ? t("navigation.notifications")
      : settingsPageKey
        ? t(settingsPageKey)
        : undefined;
  const inventoryNestedPageName = (() => {
    if (section !== "inventory") return undefined;
    if (pathSegments.length === 2) {
      if (pathSegments[1] === "favorites") return t("navigation.favorites");
      if (pathSegments[1] === "new") return t("actions.new");
      return t("breadcrumb.details");
    }
    if (pathSegments.length !== 3) return undefined;
    if (pathSegments[2] === "stock") return t("navigation.stock");
    if (pathSegments[2] === "edit") return t("breadcrumb.edit");
    return undefined;
  })();
  const stockNestedPageName =
    section === "stock" && pathSegments[1]
      ? {
          scan: t("navigation.stockScan"),
        }[pathSegments[1]]
      : undefined;
  const operationsNestedPageName = (() => {
    if (section === "contacts") return t("navigation.contacts");
    if (section === "requests") {
      return t(
        pathSegments[1] === "calendar"
          ? "navigation.reservationCalendar"
          : "navigation.requests",
      );
    }
    if (section !== "operations") return undefined;
    return {
      purchases: t("navigation.purchases"),
      sales: t("navigation.sales"),
      loans: t("navigation.loans"),
    }[pathSegments[1] ?? "purchases"];
  })();
  const locationNestedPageName =
    navigationSection === "locations"
      ? t(section === "spaces" ? "navigation.rooms" : "navigation.map")
      : undefined;
  const nestedPageName =
    settingsPageName ??
    inventoryNestedPageName ??
    stockNestedPageName ??
    operationsNestedPageName ??
    locationNestedPageName;
  const isInventoryResourceSubpage =
    section === "inventory" &&
    pathSegments.length === 3 &&
    (pathSegments[2] === "stock" || pathSegments[2] === "edit");
  const inventoryItemHref = isInventoryResourceSubpage
    ? `/inventory/${pathSegments[1]}`
    : null;
  const resourceItemBreadcrumb =
    inventoryItemHref && inventoryItemBreadcrumb?.href === inventoryItemHref
      ? inventoryItemBreadcrumb
      : null;
  const showGlobalSearch = scopedPathname !== "/inventory";

  const closeMobileNavigation = () => {
    setMobileOpen(false);
    window.requestAnimationFrame(() => mobileMenuTriggerRef.current?.focus());
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;

    const focusFrame = window.requestAnimationFrame(() =>
      mobileCloseButtonRef.current?.focus(),
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setMobileOpen(false);
        window.requestAnimationFrame(() =>
          mobileMenuTriggerRef.current?.focus(),
        );
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  return (
    <InventoryBreadcrumbProvider setItem={setInventoryItemBreadcrumb}>
      <OfflineSupportProvider ownerKey={offlineOwnerKey}>
      <OrganizationRoutingProvider
        organizationSlug={organization.slug}
        isReadOnly={organization.isReadOnly}
        allowNegativeStock={organization.allowNegativeStock}
      >
      <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] border-r border-border lg:block">
        <SidebarContent
          pathname={scopedPathname}
          user={user}
          organization={organization}
          organizations={organizations}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
            aria-label={t("actions.closeNavigation")}
            onClick={closeMobileNavigation}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={t("navigation.mainLabel")}
            className="app-shell-mobile-drawer relative h-full w-[min(320px,calc(100vw-3.5rem))] border-r border-border shadow-2xl"
          >
            <button
              ref={mobileCloseButtonRef}
              type="button"
              onClick={closeMobileNavigation}
              className="absolute right-3 top-[calc(12px+env(safe-area-inset-top))] z-10 grid size-11 place-items-center rounded-xl text-muted hover:bg-surface-muted"
              aria-label={t("actions.closeNavigation")}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <SidebarContent
              pathname={scopedPathname}
              user={user}
              organization={organization}
              organizations={organizations}
              onNavigate={closeMobileNavigation}
              showCreateMenu={false}
            />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[244px]">
        {organization.isReadOnly ? (
          <div className="sticky top-0 z-30 flex min-h-11 items-center justify-between gap-4 border-b border-brand-border bg-brand-soft px-4 py-2 text-brand sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2.5">
              <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
              <p className="min-w-0 text-xs sm:text-sm">
                <strong className="font-semibold">{t("demo.bannerLabel")}</strong>
                <span className="ml-2 hidden text-muted-strong sm:inline">
                  {t("demo.bannerDescription")}
                </span>
              </p>
            </div>
            <a
              href={websiteUrl}
              className="shrink-0 text-xs font-semibold underline-offset-4 hover:underline"
            >
              {t("demo.backToWebsite")}
            </a>
          </div>
        ) : null}
        <header
          className={cn(
            "app-shell-header sticky z-20 flex h-[var(--app-shell-header-height)] items-center border-b border-border bg-surface/90 backdrop-blur-xl",
            organization.isReadOnly ? "top-11" : "top-0",
          )}
        >
          <button
            ref={mobileMenuTriggerRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            className="mr-3 grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-muted shadow-sm lg:hidden"
            aria-label={t("actions.openNavigation")}
          >
            <Menu className="size-[18px]" aria-hidden="true" />
          </button>

          <nav
            aria-label={t("breadcrumb.label")}
            className="min-w-0 flex-1 overflow-hidden text-sm"
          >
            <ol className="flex min-w-0 items-center gap-2">
              <li className="hidden min-w-0 shrink sm:block">
                <Link
                  href="/"
                  className="block max-w-24 truncate text-muted transition hover:text-foreground sm:max-w-40"
                >
                  {organization.name}
                </Link>
              </li>
              <li className="hidden sm:block" aria-hidden="true">
                <ChevronRight className="size-3.5 shrink-0 text-muted" />
              </li>
              <li
                className={cn(
                  "min-w-0",
                  !nestedPageName && "truncate",
                  nestedPageName && "hidden sm:block",
                )}
              >
                {nestedPageName ? (
                  <Link
                    href={sectionHref}
                    className="font-semibold text-foreground transition hover:text-brand"
                  >
                    {pageName}
                  </Link>
                ) : (
                  <span
                    aria-current="page"
                    className="font-semibold text-foreground"
                  >
                    {pageName}
                  </span>
                )}
              </li>
              {resourceItemBreadcrumb ? (
                <li className="hidden sm:block" aria-hidden="true">
                  <ChevronRight className="size-3.5 shrink-0 text-muted" />
                </li>
              ) : null}
              {resourceItemBreadcrumb ? (
                <li className="hidden min-w-0 shrink sm:block">
                  <Link
                    href={resourceItemBreadcrumb.href}
                    title={resourceItemBreadcrumb.name}
                    className="block max-w-28 truncate font-medium text-muted transition hover:text-brand sm:max-w-56"
                  >
                    {resourceItemBreadcrumb.name}
                  </Link>
                </li>
              ) : null}
              {nestedPageName ? (
                <li className="hidden sm:block" aria-hidden="true">
                  <ChevronRight className="size-3.5 shrink-0 text-muted" />
                </li>
              ) : null}
              {nestedPageName ? (
                <li
                  aria-current="page"
                  className="min-w-0 truncate font-semibold text-foreground"
                >
                  {nestedPageName}
                </li>
              ) : null}
            </ol>
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {showGlobalSearch ? (
              <form
                action={organizationPath(organization.slug, "/inventory")}
                className="relative hidden lg:block"
                role="search"
              >
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  name="q"
                  aria-label={t("search.label")}
                  placeholder={t("search.placeholder")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="h-9 w-56 rounded-xl border border-border bg-surface-subtle pl-9 pr-10 text-[13px] text-foreground transition placeholder:text-muted hover:border-border-strong focus:w-64 focus:border-focus focus:bg-surface focus:outline-none focus:ring-3 focus:ring-focus/10"
                />
                <button
                  type="submit"
                  className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
                  aria-label={t("search.submit")}
                  title={t("search.action")}
                >
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              </form>
            ) : null}
            <div className="lg:hidden">
              <CreateMenu user={user} variant="compact" />
            </div>
            <NotificationBell />
          </div>
        </header>

        {organization.isReadOnly ? (
          <div
            role="status"
            className="sticky top-[68px] z-[19] border-b border-brand/20 bg-brand-soft/95 px-4 text-brand backdrop-blur-xl sm:px-6 lg:px-8"
          >
            <div className="flex min-h-10 items-center gap-2.5 py-2 text-[13px]">
              <LockKeyhole
                className="size-3.5 shrink-0"
                strokeWidth={2.2}
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1 leading-5">
                <strong className="font-semibold">{t("demo.bannerLabel")}</strong>
                <span className="hidden text-muted-strong sm:inline">
                  {" · "}
                  {t("demo.bannerDescription")}
                </span>
              </p>
              <a
                href={websiteUrl}
                className="shrink-0 font-semibold text-brand underline-offset-4 hover:underline"
              >
                {t("demo.backToWebsite")}
              </a>
            </div>
          </div>
        ) : null}

        <main
          className={cn(
            "app-shell-main",
            organization.isReadOnly && "app-shell-main--read-only",
          )}
        >
          {children}
        </main>
      </div>
      </div>
      </OrganizationRoutingProvider>
      </OfflineSupportProvider>
    </InventoryBreadcrumbProvider>
  );
}
