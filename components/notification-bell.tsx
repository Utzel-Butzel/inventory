"use client";

import { Bell } from "lucide-react";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { useCallback, useEffect, useState } from "react";
import { useT } from "next-i18next/client";

export function NotificationBell() {
  const { t } = useT("shell");
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications?limit=1", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { unread?: number };
      setUnread(Math.max(0, Number(payload.unread ?? 0)));
    } catch {
      // The shell remains usable when inbox polling is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    const refresh = () => void load();
    window.addEventListener("inventory:notifications-changed", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("inventory:notifications-changed", refresh);
    };
  }, [load]);

  return (
    <Link
      href="/notifications"
      className="relative grid size-9 place-items-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-foreground"
      aria-label={t("notifications.open", { count: unread })}
      title={t("notifications.title")}
    >
      <Bell className="size-[18px]" aria-hidden="true" />
      {unread > 0 ? (
        <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[9px] font-bold leading-4 text-on-strong">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
