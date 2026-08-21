"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useT } from "next-i18next/client";
import {
  ArrowRight,
  Camera,
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

const navigation: Array<{
  labelKey: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission?: AppPermission;
  activeHrefs?: string[];
  children?: NavigationChild[];
}> = [
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
  },
  {
    labelKey: "navigation.requests",
    href: "/requests",
    icon: ClipboardList,
    permission: "requests.read",
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
  {
    labelKey: "navigation.statistics",
    href: "/dashboard",
    icon: LayoutDashboard,
    permission: "inventory.read",
  },
  { labelKey: "navigation.settings", href: "/settings", icon: Settings },
];

const pageNames: Record<string, string> = {
  dashboard: "navigation.statistics",
  inventory: "navigation.inventory",
  stock: "navigation.stock",
  map: "navigation.map",
  spaces: "navigation.rooms",
  batch: "actions.photoCapture",
  labels: "navigation.labels",
  duplicates: "navigation.duplicates",
  notifications: "navigation.notifications",
  requests: "navigation.requests",
  settings: "navigation.settings",
};

function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const settingsPageNames: Record<string, string> = {
  user: "settings.items.user.label",
  organization: "settings.items.organization.label",
  data: "settings.items.data.label",
  languages: "settings.items.languages.label",
  "inventory-types": "settings.items.inventoryTypes.label",
  "custom-fields": "settings.items.customFields.label",
  users: "settings.items.users.label",
  access: "settings.items.access.label",
  sharing: "settings.items.sharing.label",
  notifications: "settings.items.notifications.label",
  webhooks: "settings.items.webhooks.label",
  api: "settings.items.api.label",
};

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
            ? "size-9"
            : "h-10 w-full gap-2 px-3 text-[13px]",
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
            <Link
              href="/inventory/new"
              onClick={closeMenu}
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-foreground transition hover:bg-surface-muted"
            >
              <Plus className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold">
                  {t("actions.manualEntry")}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-muted">
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
                <span className="block text-[12px] font-semibold">
                  {t("actions.photoCapture")}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-muted">
                  {t("actions.photoCaptureDescription")}
                </span>
              </span>
            </Link>
          ) : null}
          {canCreateRequest ? (
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
                <span className="block text-[12px] font-semibold">
                  {t("actions.internalRequest")}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-muted">
                  {t("actions.internalRequestDescription")}
                </span>
              </span>
            </Link>
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
          <span className="text-[15px] font-semibold">
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
        <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-sidebar-muted">
          {t("sections.workspace")}
        </p>
        <div className="space-y-0.5">
          {navigation
            .filter(
              (item) =>
                !item.permission || user.permissions.includes(item.permission),
            )
            .map((item) => {
              const active = (item.activeHrefs ?? [item.href]).some((href) =>
                isPathActive(pathname, href),
              );
              const visibleChildren = item.children?.filter(
                (child) =>
                  !child.permission || user.permissions.includes(child.permission),
              );
              const Icon = item.icon;
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={
                      active && !visibleChildren?.length ? "page" : undefined
                    }
                    className={cn(
                      "group flex h-10 items-center gap-3 rounded-xl px-2.5 text-[13px] font-medium transition",
                      active
                        ? "bg-brand-soft text-brand"
                        : "text-sidebar-muted-strong hover:bg-surface-muted hover:text-foreground",
                    )}
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
                    {t(item.labelKey)}
                  </Link>

                  {active && visibleChildren?.length ? (
                    <div className="ml-[18px] mt-1 space-y-0.5 border-l border-border pl-[18px]">
                      {visibleChildren.map((child) => {
                        const childActive = isPathActive(pathname, child.href);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={onNavigate}
                            aria-current={childActive ? "page" : undefined}
                            className={cn(
                              "flex min-h-8 items-center rounded-lg px-2 text-[12px] font-medium transition",
                              childActive
                                ? "text-brand"
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
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[10px] font-bold text-brand">
            {initials(user.name, user.email, t("user.generic"))}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-foreground">
              {user.name || t("user.fallbackName")}
            </p>
            <p className="truncate text-[10px] text-sidebar-muted">
              {user.email || t("user.signedIn")}
            </p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-brand">
              {user.roleName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-sidebar-muted transition hover:bg-surface-muted hover:text-foreground"
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
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const pathSegments = scopedPathname.split("/").filter(Boolean);
  const section = pathSegments[0] ?? "inventory";
  const pageName = t(pageNames[section] ?? "navigation.inventory");
  const settingsPageKey =
    section === "settings" && pathSegments[1]
      ? settingsPageNames[pathSegments[1]]
      : undefined;
  const settingsPageName = settingsPageKey ? t(settingsPageKey) : undefined;
  const inventoryNestedPageName =
    section === "inventory" &&
    pathSegments.length === 2 &&
    pathSegments[1] !== "new"
      ? t("breadcrumb.details")
      : section === "inventory" &&
          pathSegments.length === 3 &&
          pathSegments[2] === "stock"
        ? t("navigation.stock")
        : undefined;
  const requestNestedPageName =
    section === "requests" && pathSegments[1] === "calendar"
      ? t("navigation.reservationCalendar")
      : undefined;
  const nestedPageName =
    settingsPageName ?? inventoryNestedPageName ?? requestNestedPageName;
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
            className="relative h-full w-[min(300px,86vw)] border-r border-border shadow-2xl"
          >
            <button
              ref={mobileCloseButtonRef}
              type="button"
              onClick={closeMobileNavigation}
              className="absolute right-3 top-[18px] z-10 grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-muted"
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
            "sticky z-20 flex h-[68px] items-center border-b border-border bg-surface/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8",
            organization.isReadOnly ? "top-11" : "top-0",
          )}
        >
          <button
            ref={mobileMenuTriggerRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            className="mr-3 grid size-9 place-items-center rounded-xl border border-border bg-surface text-muted shadow-sm lg:hidden"
            aria-label={t("actions.openNavigation")}
          >
            <Menu className="size-[18px]" aria-hidden="true" />
          </button>

          <nav
            aria-label={t("breadcrumb.label")}
            className="min-w-0 flex-1 overflow-hidden text-sm"
          >
            <ol className="flex min-w-0 items-center gap-2">
              <li className="min-w-0 shrink">
                <Link
                  href="/"
                  className="block max-w-24 truncate text-muted transition hover:text-foreground sm:max-w-40"
                >
                  {organization.name}
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="size-3.5 shrink-0 text-muted" />
              </li>
              <li className={cn("min-w-0", !nestedPageName && "truncate")}>
                {nestedPageName ? (
                  <Link
                    href={`/${section}`}
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
              {nestedPageName ? (
                <li aria-hidden="true">
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
                  className="h-9 w-56 rounded-xl border border-border bg-surface-subtle pl-9 pr-10 text-[12px] text-foreground transition placeholder:text-muted hover:border-border-strong focus:w-64 focus:border-focus focus:bg-surface focus:outline-none focus:ring-3 focus:ring-focus/10"
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
            <div className="flex min-h-10 items-center gap-2.5 py-2 text-[12px]">
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
            "min-h-[calc(100dvh-68px)]",
            organization.isReadOnly && "min-h-[calc(100dvh-109px)]",
          )}
        >
          {children}
        </main>
      </div>
      </div>
      </OrganizationRoutingProvider>
    </OfflineSupportProvider>
  );
}
