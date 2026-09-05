"use client";

import { ListViewToolbar, ListViewResults, useListView } from "@/components/list-view";
import { orderListItems } from "@/lib/list-view-contract";


import { Bell, CheckCheck, Clock3, PackageMinus, ShieldAlert, Wrench } from "lucide-react";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import type { NotificationEventType, NotificationMetadata } from "@/lib/notification-contract";

type InboxNotification = {
  id: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  href: string | null;
  metadata: NotificationMetadata;
  readAt: string | null;
  createdAt: string;
};

const icons = {
  low_stock: PackageMinus,
  expiry: Clock3,
  maintenance: Wrench,
  return_due: Clock3,
} as const;

export function NotificationInbox() {
  const { t, i18n } = useT("notifications");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const list = useListView("notifications", { sort: "createdAt", direction: "desc", filters: { read: "all", category: "all" } });
  const unreadOnly = list.config.filters.read === "unread";
  const [saving, setSaving] = useState(false);

  const date = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/notifications?limit=100`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("errors.load"));
      const payload = (await response.json()) as {
        notifications: InboxNotification[];
        unread: number;
      };
      setNotifications(payload.notifications);
      setUnread(payload.unread);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => void load(), [load]);

  const changed = () =>
    window.dispatchEvent(new Event("inventory:notifications-changed"));

  async function markRead(notification: InboxNotification) {
    if (notification.readAt) return;
    try {
      const response = await fetch(`/api/v1/notifications/${notification.id}`, {
        method: "PATCH",
      });
      if (!response.ok) throw new Error(t("errors.update"));
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, readAt } : item,
        ),
      );
      setUnread((current) => Math.max(0, current - 1));
      changed();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t("errors.update"));
    }
  }

  async function markAllRead() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/notifications/read-all", {
        method: "POST",
      });
      if (!response.ok) throw new Error(t("errors.update"));
      setUnread(0);
      setNotifications((current) =>
        current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
      );
      changed();
      if (unreadOnly) await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t("errors.update"));
    } finally {
      setSaving(false);
    }
  }

  const visibleNotifications = useMemo(() => orderListItems(notifications.filter((notification) => {
    if (unreadOnly && notification.readAt) return false;
    if (list.config.filters.read === "read" && !notification.readAt) return false;
    if (list.config.filters.category !== "all" && list.config.filters.category !== notification.eventType) return false;
    const query = list.config.query.trim().toLocaleLowerCase(locale);
    return !query || [notification.title, notification.body].join(" ").toLocaleLowerCase(locale).includes(query);
  }), list.config, { createdAt: (notification) => notification.createdAt, title: (notification) => notification.title }, locale), [notifications, unreadOnly, list.config, locale]);

  return (
    <div className="mx-auto w-full max-w-[980px]">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
            {t("eyebrow")}
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground">
            {t("title")}
          </h1>
          <p className="mt-2 text-sm text-muted">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void markAllRead()}
            disabled={!unread || saving}
          >
            <CheckCheck className="size-4" aria-hidden="true" />
            {t("markAllRead")}
          </Button>
        </div>
      </header>

      {error ? (
        <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <ListViewToolbar list={list} total={visibleNotifications.length} loadedOnly
        sorts={["createdAt", "title"].map((value) => ({ value, label: t("common:listView.fields." + value) }))}
        filters={[
          { key: "read", label: t("common:listView.fields.read"), options: [{ value: "unread", label: t("showUnread") }, { value: "read", label: t("common:listView.readLabel") }] },
          { key: "category", label: t("common:listView.fields.category"), options: Object.keys(icons).map((value) => ({ value, label: t("common:listView.events." + value) })) },
        ]} />
      <ListViewResults list={list}>
      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
        ) : visibleNotifications.length === 0 ? (
          <EmptyState
            icon={<Bell className="size-5" aria-hidden="true" />}
            title={notifications.length ? t("common:listView.noResults") : unreadOnly ? t("emptyUnreadTitle") : t("emptyTitle")}
            description={notifications.length ? t("common:listView.noResultsHint") : unreadOnly ? t("emptyUnreadDescription") : t("emptyDescription")}
          />
        ) : (
          <div className="divide-y divide-border">
            {visibleNotifications.map((notification) => {
              const Icon = icons[notification.eventType];
              const content = (
                <div data-list-row className="flex items-start gap-3 px-4 py-4 sm:px-5">
                  <span className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl",
                    notification.readAt ? "bg-surface-muted text-muted" : "bg-brand-soft text-brand",
                  )}>
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">
                        {notification.title}
                      </h2>
                      {!notification.readAt ? <Badge tone="brand">{t("new")}</Badge> : null}
                    </div>
                    <p className="mt-1 text-[14px] leading-5 text-muted-strong">
                      {notification.body}
                    </p>
                    <p className="mt-2 text-[11px] text-muted">
                      {date.format(new Date(notification.createdAt))}
                    </p>
                  </div>
                </div>
              );
              return notification.href ? (
                <Link
                  key={notification.id}
                  href={notification.href}
                  onClick={() => void markRead(notification)}
                  className="block transition hover:bg-surface-subtle"
                >
                  {content}
                </Link>
              ) : (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void markRead(notification)}
                  className="block w-full text-left transition hover:bg-surface-subtle"
                >
                  {content}
                </button>
              );
            })}
          </div>
        )}
      </Card>
      </ListViewResults>
    </div>
  );
}
