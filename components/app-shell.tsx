"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  Boxes,
  ChevronRight,
  CircleHelp,
  Files,
  LayoutDashboard,
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

import { cn } from "@/components/ui";
import type { UserRole } from "@/db/schema";

type ShellUser = {
  name?: string | null;
  email?: string | null;
  role: UserRole;
};

const navigation = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Inventory", href: "/inventory", icon: PackageOpen },
  { label: "Stock", href: "/stock", icon: Warehouse },
  { label: "Locations", href: "/map", icon: MapPinned },
  { label: "Rooms 3D", href: "/spaces", icon: Boxes },
  { label: "Batch studio", href: "/batch", icon: Sparkles },
  { label: "Labels", href: "/labels", icon: ScanQrCode },
  { label: "Duplicates", href: "/duplicates", icon: Files },
];

const manageNavigation = [
  { label: "Settings", href: "/settings", icon: Settings },
];

const pageNames: Record<string, string> = {
  dashboard: "Overview",
  inventory: "Inventory",
  stock: "Stock",
  map: "Locations",
  spaces: "Rooms 3D",
  batch: "Batch studio",
  labels: "Labels",
  duplicates: "Duplicates",
  settings: "Settings",
};

function initials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "User";
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`
    : source.slice(0, 2)
  ).toUpperCase();
}

function SidebarContent({
  pathname,
  user,
  onNavigate,
}: {
  pathname: string;
  user: ShellUser;
  onNavigate?: () => void;
}) {
  const canWrite = user.role !== "viewer";
  return (
    <div className="flex h-full flex-col bg-[#fbfbfc]">
      <div className="flex h-[68px] items-center px-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg text-[#1f2227]"
        >
          <span className="grid size-8 place-items-center rounded-[10px] bg-[#635bff] text-white shadow-[0_5px_14px_rgba(99,91,255,0.22)]">
            <Boxes className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em]">
            Inventory
          </span>
        </Link>
      </div>

      {canWrite ? (
        <div className="px-3.5 pt-2">
          <Link
            href="/inventory/new"
            onClick={onNavigate}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#635bff] px-3 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#5147f5] active:bg-[#443be0]"
          >
            <Plus className="size-4" strokeWidth={2.2} aria-hidden="true" />
            Add inventory item
          </Link>
        </div>
      ) : null}

      <nav className="mt-6 flex-1 px-3" aria-label="Main navigation">
        <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#989ea8]">
          Workspace
        </p>
        <div className="space-y-0.5">
          {navigation
            .filter((item) => canWrite || item.href !== "/batch")
            .map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
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
                    ? "bg-[#eeedff] text-[#5147d9]"
                    : "text-[#616873] hover:bg-[#f0f2f4] hover:text-[#292d33]",
                )}
              >
                <Icon
                  className={cn(
                    "size-[17px] shrink-0",
                    active
                      ? "text-[#635bff]"
                      : "text-[#858b95] group-hover:text-[#555c67]",
                  )}
                  strokeWidth={active ? 2.2 : 1.9}
                  aria-hidden="true"
                />
                {item.label}
                {item.href === "/batch" ? (
                  <span className="ml-auto rounded-full bg-[#e1dfff] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#5d55db]">
                    AI
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>

        <p className="mb-2 mt-7 px-2.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#989ea8]">
          Manage
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
                    ? "bg-[#eeedff] text-[#5147d9]"
                    : "text-[#616873] hover:bg-[#f0f2f4] hover:text-[#292d33]",
                )}
              >
                <Icon
                  className={cn(
                    "size-[17px]",
                    active
                      ? "text-[#635bff]"
                      : "text-[#858b95] group-hover:text-[#555c67]",
                  )}
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-[#e8eaed] p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e6e4ff] text-[10px] font-bold text-[#554ddb]">
            {initials(user.name, user.email)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-[#34383e]">
              {user.name || "Inventory admin"}
            </p>
            <p className="truncate text-[10px] text-[#9298a2]">
              {user.email || "Signed in"}
            </p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8b83df]">
              {user.role}
            </p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ redirectTo: "/login" })}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[#8b919b] transition hover:bg-[#eceef1] hover:text-[#3b3f46]"
            aria-label="Sign out"
            title="Sign out"
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
}: {
  children: React.ReactNode;
  user: ShellUser;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const section = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  const pageName = pageNames[section] ?? "Inventory";

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
    <div className="min-h-dvh bg-[#f6f7f9]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] border-r border-[#e4e7eb] lg:block">
        <SidebarContent pathname={pathname} user={user} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[#17191c]/35 backdrop-blur-[2px]"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative h-full w-[min(300px,86vw)] border-r border-[#e4e7eb] shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-[18px] z-10 grid size-8 place-items-center rounded-lg text-[#737984] hover:bg-[#eceef1]"
              aria-label="Close navigation"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <SidebarContent
              pathname={pathname}
              user={user}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[244px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center border-b border-[#e4e7eb] bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="mr-3 grid size-9 place-items-center rounded-xl border border-[#e2e5e9] bg-white text-[#5d646f] shadow-sm lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-[18px]" aria-hidden="true" />
          </button>

          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden text-[#a0a5ae] sm:inline">Workspace</span>
            <ChevronRight
              className="hidden size-3.5 text-[#b5bac1] sm:block"
              aria-hidden="true"
            />
            <span className="truncate font-semibold text-[#34383e]">{pageName}</span>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <form
              action="/inventory"
              className="relative hidden md:block"
              role="search"
            >
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9197a1]"
                aria-hidden="true"
              />
              <input
                type="search"
                name="q"
                aria-label="Search inventory"
                placeholder="Search inventory…"
                className="h-9 w-56 rounded-xl border border-[#e1e4e8] bg-[#f8f9fa] pl-9 pr-3 text-[12px] text-[#33373d] transition placeholder:text-[#9298a2] hover:border-[#d4d8de] focus:w-64 focus:border-[#776fff] focus:bg-white focus:outline-none focus:ring-3 focus:ring-[#635bff]/10"
              />
            </form>
            <Link
              href="/settings"
              className="grid size-9 place-items-center rounded-xl text-[#7d838d] transition hover:bg-[#f0f2f4] hover:text-[#33373d]"
              aria-label="Help and configuration"
              title="Help and configuration"
            >
              <CircleHelp className="size-[18px]" aria-hidden="true" />
            </Link>
            {user.role !== "viewer" ? (
              <Link
                href="/inventory/new"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#635bff] px-3 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[#5147f5] sm:px-3.5"
              >
                <Plus className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
                <span className="hidden sm:inline">Add item</span>
              </Link>
            ) : null}
          </div>
        </header>

        <main className="min-h-[calc(100dvh-68px)]">{children}</main>
      </div>
    </div>
  );
}
