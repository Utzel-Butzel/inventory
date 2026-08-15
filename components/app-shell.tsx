"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useT } from "next-i18next/client";
import {
  ArrowRight,
  Boxes,
  ChevronRight,
  CircleHelp,
  Files,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MapPinned,
  Menu,
  PackageOpen,
  Plus,
  Search,
  ScanQrCode,
  Settings,
  Sparkles,
  Warehouse,
  X,
} from "lucide-react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { NotificationBell } from "@/components/notification-bell";
import {
  OrganizationLink as Link,
  OrganizationRoutingProvider,
} from "@/components/organization-routing";
import {
  OrganizationSwitcher,
  type ActiveOrganization,
  type OrganizationMembershipSummary,
} from "@/components/organization-switcher";
import { LocalizedThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/components/ui";
import type { UserRole } from "@/db/schema";
import type { ApiScope, AppPermission } from "@/lib/access-control-contract";
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

const navigation: Array<{
  labelKey: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission?: AppPermission;
  scope?: ApiScope;
}> = [
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
  },
  {
    labelKey: "navigation.stock",
    href: "/stock",
    icon: Warehouse,
    permission: "stock.read",
  },
  {
    labelKey: "navigation.locations",
    href: "/map",
    icon: MapPinned,
    permission: "spatial.read",
  },
  {
    labelKey: "navigation.rooms",
    href: "/spaces",
    icon: Boxes,
    permission: "spatial.read",
  },
  {
    labelKey: "navigation.batch",
    href: "/batch",
    icon: Sparkles,
    scope: "write",
  },
  {
    labelKey: "navigation.labels",
    href: "/labels",
    icon: ScanQrCode,
    permission: "labels.read",
  },
  {
    labelKey: "navigation.duplicates",
    href: "/duplicates",
    icon: Files,
    permission: "inventory.read",
  },
];

const manageNavigation = [
  { labelKey: "navigation.settings", href: "/settings", icon: Settings },
];

const pageNames: Record<string, string> = {
  dashboard: "navigation.overview",
  inventory: "navigation.inventory",
  stock: "navigation.stock",
  map: "navigation.locations",
  spaces: "navigation.rooms",
  batch: "navigation.batch",
  labels: "navigation.labels",
  duplicates: "navigation.duplicates",
  notifications: "navigation.notifications",
  settings: "navigation.settings",
};

const settingsPageNames: Record<string, string> = {
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

function SidebarContent({
  pathname,
  user,
  organization,
  organizations,
  onNavigate,
}: {
  pathname: string;
  user: ShellUser;
  organization: ActiveOrganization;
  organizations: OrganizationMembershipSummary[];
  onNavigate?: () => void;
}) {
  const { t } = useT(["shell", "common"]);
  const canCreate = user.permissions.includes("inventory.create");
  return (
    <div className="flex h-full flex-col bg-surface-subtle">
      <div className="flex h-[68px] items-center px-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg text-foreground"
        >
          <span className="grid size-8 place-items-center rounded-[10px] bg-brand-solid text-on-brand shadow-[0_5px_14px_rgba(99,91,255,0.22)]">
            <Boxes
              className="size-[18px]"
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em]">
            {t("brand")}
          </span>
        </Link>
      </div>

      <div className="px-3.5 pt-2">
        <OrganizationSwitcher
          organization={organization}
          organizations={organizations}
        />
      </div>

      {canCreate ? (
        <div className="px-3.5 pt-2">
          <Link
            href="/inventory/new"
            onClick={onNavigate}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-solid px-3 text-[13px] font-semibold text-on-brand shadow-sm transition hover:bg-brand-hover active:bg-brand-active"
          >
            <Plus className="size-4" strokeWidth={2.2} aria-hidden="true" />
            {t("actions.addInventoryItem")}
          </Link>
        </div>
      ) : null}

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
                (!item.permission ||
                  user.permissions.includes(item.permission)) &&
                (!item.scope || user.scopes.includes(item.scope)),
            )
            .map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" &&
                  pathname.startsWith(`${item.href}/`));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
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
                  {item.href === "/batch" ? (
                    <span className="ml-auto rounded-full bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand">
                      {t("badges.ai")}
                    </span>
                  ) : null}
                </Link>
              );
            })}
        </div>

        <p className="mb-2 mt-7 px-2.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-sidebar-muted">
          {t("sections.manage")}
        </p>
        <div className="space-y-0.5">
          {manageNavigation.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-10 items-center gap-3 rounded-xl px-2.5 text-[13px] font-medium transition",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-sidebar-muted-strong hover:bg-surface-muted hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-[17px]",
                    active
                      ? "text-brand"
                      : "text-sidebar-muted group-hover:text-sidebar-muted-strong",
                  )}
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
                {t(item.labelKey)}
              </Link>
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
            onClick={() => signOut({ redirectTo: "/login" })}
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
  user,
  organization,
  organizations,
  websiteUrl,
}: {
  children: React.ReactNode;
  user: ShellUser;
  organization: ActiveOrganization;
  organizations: OrganizationMembershipSummary[];
  websiteUrl: string;
}) {
  const pathname = usePathname();
  const scopedPathname = stripOrganizationPathname(pathname);
  const { t } = useT("shell");
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathSegments = scopedPathname.split("/").filter(Boolean);
  const section = pathSegments[0] ?? "dashboard";
  const pageName = t(pageNames[section] ?? "navigation.inventory");
  const settingsPageKey =
    section === "settings" && pathSegments[1]
      ? settingsPageNames[pathSegments[1]]
      : undefined;
  const settingsPageName = settingsPageKey ? t(settingsPageKey) : undefined;

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <OrganizationRoutingProvider
      organizationId={organization.id}
      isReadOnly={organization.isReadOnly}
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
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative h-full w-[min(300px,86vw)] border-r border-border shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
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
              onNavigate={() => setMobileOpen(false)}
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
            type="button"
            onClick={() => setMobileOpen(true)}
            className="mr-3 grid size-9 place-items-center rounded-xl border border-border bg-surface text-muted shadow-sm lg:hidden"
            aria-label={t("actions.openNavigation")}
          >
            <Menu className="size-[18px]" aria-hidden="true" />
          </button>

          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden max-w-40 truncate text-muted sm:inline">
              {organization.name}
            </span>
            <ChevronRight
              className="hidden size-3.5 text-muted sm:block"
              aria-hidden="true"
            />
            <span className="shrink-0 font-semibold text-foreground">
              {pageName}
            </span>
            {settingsPageName ? (
              <>
                <ChevronRight
                  className="size-3.5 shrink-0 text-muted"
                  aria-hidden="true"
                />
                <span className="truncate font-semibold text-foreground">
                  {settingsPageName}
                </span>
              </>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <form
              action={organizationPath(organization.id, "/inventory")}
              className="relative hidden md:block"
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
            <NotificationBell />
            <LanguageSwitcher compact />
            <LocalizedThemeToggle />
            <Link
              href="/settings"
              className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-foreground"
              aria-label={t("actions.helpAndConfiguration")}
              title={t("actions.helpAndConfiguration")}
            >
              <CircleHelp className="size-[18px]" aria-hidden="true" />
            </Link>
          </div>
        </header>

        <main className="min-h-[calc(100dvh-68px)]">{children}</main>
      </div>
    </div>
    </OrganizationRoutingProvider>
  );
}
