"use client";

import {
  Bell,
  BellRing,
  Check,
  Clock3,
  LoaderCircle,
  Mail,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, Skeleton, cn } from "@/components/ui";
import {
  pickNotificationPreferencePatch,
  type NotificationChannel,
  type NotificationEventType,
  type NotificationFrequency,
  type NotificationLocale,
} from "@/lib/notification-contract";

type Preference = {
  recipientKey: string;
  recipientEmail: string | null;
  enabledEventTypes: NotificationEventType[];
  frequency: NotificationFrequency;
  digestHour: number;
  timezone: string;
  locale: NotificationLocale;
  cooldownHours: number;
  lowStockThresholdPercent: number;
  expiryWindowDays: number;
  expiryFieldKey: string;
  maintenanceWindowDays: number;
  maintenanceFieldKey: string;
  returnDueWindowDays: number;
  emailEnabled: boolean;
  pushEnabled: boolean;
  slackEnabled: boolean;
  teamsEnabled: boolean;
  webhookEnabled: boolean;
};

type RuntimeChannel = {
  configured: boolean;
  target: string | null;
  publicKey?: string | null;
};

type SettingsResponse = {
  preference: Preference & {
    recipientName: string | null;
    lastDigestAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  runtime: Record<NotificationChannel, RuntimeChannel>;
  pushSubscriptionCount: number;
};

type SettingsState = Omit<SettingsResponse, "preference"> & {
  preference: Preference;
};

function editablePreference(preference: SettingsResponse["preference"]): Preference {
  return {
    recipientKey: preference.recipientKey,
    recipientEmail: preference.recipientEmail,
    enabledEventTypes: preference.enabledEventTypes,
    frequency: preference.frequency,
    digestHour: preference.digestHour,
    timezone: preference.timezone,
    locale: preference.locale,
    cooldownHours: preference.cooldownHours,
    lowStockThresholdPercent: preference.lowStockThresholdPercent,
    expiryWindowDays: preference.expiryWindowDays,
    expiryFieldKey: preference.expiryFieldKey,
    maintenanceWindowDays: preference.maintenanceWindowDays,
    maintenanceFieldKey: preference.maintenanceFieldKey,
    returnDueWindowDays: preference.returnDueWindowDays,
    emailEnabled: preference.emailEnabled,
    pushEnabled: preference.pushEnabled,
    slackEnabled: preference.slackEnabled,
    teamsEnabled: preference.teamsEnabled,
    webhookEnabled: preference.webhookEnabled,
  };
}

function isFreshPreference(preference: SettingsResponse["preference"]) {
  const createdAt = Date.parse(preference.createdAt);
  const updatedAt = Date.parse(preference.updatedAt);
  return (
    preference.lastDigestAt === null &&
    Number.isFinite(createdAt) &&
    Number.isFinite(updatedAt) &&
    Math.abs(updatedAt - createdAt) <= 5_000
  );
}

const eventTypes: NotificationEventType[] = [
  "low_stock",
  "expiry",
  "maintenance",
  "return_due",
];

const channels: Array<{
  key: NotificationChannel;
  field: keyof Pick<
    Preference,
    "emailEnabled" | "pushEnabled" | "slackEnabled" | "teamsEnabled" | "webhookEnabled"
  >;
  icon: typeof Mail;
}> = [
  { key: "email", field: "emailEnabled", icon: Mail },
  { key: "push", field: "pushEnabled", icon: Smartphone },
  { key: "slack", field: "slackEnabled", icon: MessageSquare },
  { key: "teams", field: "teamsEnabled", icon: MessageSquare },
  { key: "webhook", field: "webhookEnabled", icon: Webhook },
];

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:bg-surface-subtle disabled:text-muted";

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function NotificationSettingsManager() {
  const { t, i18n } = useT("settings");
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [draft, setDraft] = useState<Preference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const [testing, setTesting] = useState<NotificationChannel | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/notifications/preferences", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(t("notifications.errors.load"));
      const payload = (await response.json()) as SettingsResponse;
      const preference = editablePreference(payload.preference);
      setSettings({ ...payload, preference });
      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const firstVisitPatch: Partial<Preference> = {};
      const suggestionKey = "inventory.notifications.defaults-suggested";
      const shouldSuggestDefaults =
        isFreshPreference(payload.preference) &&
        window.sessionStorage.getItem(suggestionKey) !== "1";
      if (shouldSuggestDefaults) {
        window.sessionStorage.setItem(suggestionKey, "1");
        if (preference.timezone === "UTC" && browserTimezone) {
          firstVisitPatch.timezone = browserTimezone;
        }
        if (preference.locale === "en" && i18n.resolvedLanguage === "de") {
          firstVisitPatch.locale = "de";
        }
      }
      setDraft({ ...preference, ...firstVisitPatch });
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t("notifications.errors.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [i18n.resolvedLanguage, t]);

  useEffect(() => void load(), [load]);

  const changed = useMemo(
    () => Boolean(settings && draft && JSON.stringify(settings.preference) !== JSON.stringify(draft)),
    [draft, settings],
  );

  const patchDraft = <Key extends keyof Preference>(key: Key, value: Preference[Key]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  function toggleEvent(eventType: NotificationEventType) {
    if (!draft) return;
    patchDraft(
      "enabledEventTypes",
      draft.enabledEventTypes.includes(eventType)
        ? draft.enabledEventTypes.filter((item) => item !== eventType)
        : [...draft.enabledEventTypes, eventType],
    );
  }

  async function persist(patch: Partial<Preference>, success?: string) {
    const response = await fetch("/api/v1/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || t("notifications.errors.save"));
    }
    if (success) setNotice(success);
    await load(true);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const patch = pickNotificationPreferencePatch(draft);
      await persist(patch, t("notifications.notices.saved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("notifications.errors.save"));
    } finally {
      setSaving(false);
    }
  }

  async function subscribePush() {
    const publicKey = settings?.runtime.push.publicKey;
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError(t("notifications.errors.pushUnsupported"));
      return;
    }
    setPushSaving(true);
    setError(null);
    setNotice(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(t("notifications.errors.pushDenied"));
      const registration = await navigator.serviceWorker.register("/notification-sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        }));
      const response = await fetch("/api/v1/notifications/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error(t("notifications.errors.pushSubscribe"));
      await persist({ pushEnabled: true }, t("notifications.notices.pushEnabled"));
    } catch (pushError) {
      setError(
        pushError instanceof Error ? pushError.message : t("notifications.errors.pushSubscribe"),
      );
    } finally {
      setPushSaving(false);
    }
  }

  async function unsubscribePush() {
    setPushSaving(true);
    setError(null);
    setNotice(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/v1/notifications/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      await persist({ pushEnabled: false }, t("notifications.notices.pushDisabled"));
    } catch (pushError) {
      setError(
        pushError instanceof Error ? pushError.message : t("notifications.errors.pushUnsubscribe"),
      );
    } finally {
      setPushSaving(false);
    }
  }

  async function previewChannel(channel: NotificationChannel) {
    setTesting(channel);
    setError(null);
    setNotice(null);
    setPreview(null);
    try {
      const response = await fetch("/api/v1/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (!response.ok) throw new Error(t("notifications.errors.preview"));
      const payload = (await response.json()) as {
        configured: boolean;
        preview: { subject: string; target: string | null; events: Array<{ title: string; body: string }> };
      };
      setPreview(
        `${payload.preview.subject}\n${payload.preview.target ?? t("notifications.channels.notConfigured")}\n\n${payload.preview.events
          .map((event) => `${event.title}: ${event.body}`)
          .join("\n")}`,
      );
      setNotice(t("notifications.notices.previewOnly"));
    } catch (previewError) {
      setError(
        previewError instanceof Error ? previewError.message : t("notifications.errors.preview"),
      );
    } finally {
      setTesting(null);
    }
  }

  if (loading && !draft) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-44" />)}
      </div>
    );
  }

  if (!draft || !settings) {
    return (
      <Card className="p-5">
        <p className="text-sm text-danger">{error ?? t("notifications.errors.load")}</p>
        <Button variant="secondary" className="mt-4" onClick={() => void load()}>
          <RefreshCw className="size-4" /> {t("notifications.actions.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {error ? <p role="alert" className="rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p role="status" className="flex items-center gap-2 rounded-xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success"><Check className="size-4" /> {notice}</p> : null}

      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-border p-5 sm:p-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><BellRing className="size-5" /></span>
          <div><h2 className="font-semibold text-foreground">{t("notifications.events.title")}</h2><p className="mt-1 text-sm text-muted">{t("notifications.events.description")}</p></div>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
          {eventTypes.map((eventType) => {
            const active = draft.enabledEventTypes.includes(eventType);
            return (
              <button
                key={eventType}
                type="button"
                onClick={() => toggleEvent(eventType)}
                aria-pressed={active}
                className={cn("rounded-xl border p-4 text-left transition", active ? "border-brand-border bg-brand-soft" : "border-border bg-surface hover:bg-surface-subtle")}
              >
                <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-foreground">{t(`notifications.events.${eventType}.label`)}</span><span className={cn("grid size-5 place-items-center rounded-md border", active ? "border-brand bg-brand-solid text-on-brand" : "border-border")}>{active ? <Check className="size-3.5" /> : null}</span></div>
                <p className="mt-1.5 text-xs leading-5 text-muted">{t(`notifications.events.${eventType}.description`)}</p>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-border p-5 sm:p-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success-soft text-success"><Clock3 className="size-5" /></span>
          <div><h2 className="font-semibold text-foreground">{t("notifications.noise.title")}</h2><p className="mt-1 text-sm text-muted">{t("notifications.noise.description")}</p></div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4 sm:p-6">
          <label className="text-xs font-semibold text-muted-strong">{t("notifications.noise.frequency")}<select value={draft.frequency} onChange={(event) => patchDraft("frequency", event.target.value as NotificationFrequency)} className={inputClass}><option value="daily">{t("notifications.noise.daily")}</option><option value="immediate">{t("notifications.noise.immediate")}</option></select></label>
          <label className="text-xs font-semibold text-muted-strong">{t("notifications.noise.digestHour")}<input type="number" min={0} max={23} value={draft.digestHour} disabled={draft.frequency !== "daily"} onChange={(event) => patchDraft("digestHour", Number(event.target.value))} className={inputClass} /></label>
          <label className="text-xs font-semibold text-muted-strong">{t("notifications.noise.timezone")}<input value={draft.timezone} onChange={(event) => patchDraft("timezone", event.target.value)} className={inputClass} /></label>
          <label className="text-xs font-semibold text-muted-strong">{t("notifications.noise.language")}<select value={draft.locale} onChange={(event) => patchDraft("locale", event.target.value as NotificationLocale)} className={inputClass}><option value="en">English</option><option value="de">Deutsch</option></select></label>
          <label className="text-xs font-semibold text-muted-strong">{t("notifications.noise.cooldown")}<input type="number" min={1} max={720} value={draft.cooldownHours} onChange={(event) => patchDraft("cooldownHours", Number(event.target.value))} className={inputClass} /></label>
          <label className="text-xs font-semibold text-muted-strong">{t("notifications.thresholds.lowStock")}<input type="number" min={1} max={500} value={draft.lowStockThresholdPercent} onChange={(event) => patchDraft("lowStockThresholdPercent", Number(event.target.value))} className={inputClass} /></label>
          <label className="text-xs font-semibold text-muted-strong">{t("notifications.thresholds.expiryWindow")}<input type="number" min={0} max={3650} value={draft.expiryWindowDays} onChange={(event) => patchDraft("expiryWindowDays", Number(event.target.value))} className={inputClass} /></label>
          <label className="text-xs font-semibold text-muted-strong">{t("notifications.thresholds.maintenanceWindow")}<input type="number" min={0} max={3650} value={draft.maintenanceWindowDays} onChange={(event) => patchDraft("maintenanceWindowDays", Number(event.target.value))} className={inputClass} /></label>
          <label className="text-xs font-semibold text-muted-strong">{t("notifications.thresholds.returnWindow")}<input type="number" min={0} max={365} value={draft.returnDueWindowDays} onChange={(event) => patchDraft("returnDueWindowDays", Number(event.target.value))} className={inputClass} /></label>
          <label className="text-xs font-semibold text-muted-strong sm:col-span-2">{t("notifications.thresholds.expiryField")}<input value={draft.expiryFieldKey} onChange={(event) => patchDraft("expiryFieldKey", event.target.value)} className={inputClass} /></label>
          <label className="text-xs font-semibold text-muted-strong sm:col-span-2">{t("notifications.thresholds.maintenanceField")}<input value={draft.maintenanceFieldKey} onChange={(event) => patchDraft("maintenanceFieldKey", event.target.value)} className={inputClass} /></label>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-border p-5 sm:p-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-soft text-info"><Send className="size-5" /></span>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-foreground">{t("notifications.channels.title")}</h2><Badge tone="neutral">{t("notifications.channels.optIn")}</Badge></div><p className="mt-1 text-sm text-muted">{t("notifications.channels.description")}</p></div>
        </div>
        <div className="divide-y divide-border">
          <div className="flex items-center gap-3 px-5 py-4 sm:px-6"><span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand"><Bell className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground">{t("notifications.channels.inApp.label")}</p><p className="mt-0.5 text-xs text-muted">{t("notifications.channels.inApp.description")}</p></div><Badge tone="success">{t("notifications.channels.alwaysOn")}</Badge></div>
          {channels.map(({ key, field, icon: Icon }) => {
            const runtime = settings.runtime[key];
            const enabled = Boolean(draft[field]);
            const isPush = key === "push";
            return (
              <div key={key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted"><Icon className="size-4" /></span>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-foreground">{t(`notifications.channels.${key}.label`)}</p><Badge tone={runtime.configured ? "success" : "neutral"}>{runtime.configured ? t("notifications.channels.configured") : t("notifications.channels.notConfigured")}</Badge></div><p className="mt-0.5 text-xs text-muted">{runtime.target ?? t(`notifications.channels.${key}.description`)}</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void previewChannel(key)} disabled={testing !== null}>{testing === key ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}{t("notifications.actions.preview")}</Button>
                  {isPush ? (
                    <Button size="sm" variant={enabled ? "secondary" : "primary"} disabled={!runtime.configured || pushSaving} onClick={() => void (enabled ? unsubscribePush() : subscribePush())}>{pushSaving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{enabled ? t("notifications.actions.disable") : t("notifications.actions.enable")}</Button>
                  ) : (
                    <label className={cn("flex items-center gap-2 text-xs font-semibold", !runtime.configured && "cursor-not-allowed opacity-50")}><input type="checkbox" checked={enabled} disabled={!runtime.configured} onChange={(event) => patchDraft(field, event.target.checked)} />{enabled ? t("notifications.channels.enabled") : t("notifications.channels.disabled")}</label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {preview ? <pre className="whitespace-pre-wrap border-t border-border bg-surface-subtle p-5 text-xs leading-5 text-muted-strong">{preview}</pre> : null}
      </Card>

      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface/95 p-3 shadow-[var(--shadow-lg)] backdrop-blur">
        <p className="text-xs text-muted">{changed ? t("notifications.unsaved") : t("notifications.savedState")}</p>
        <Button onClick={() => void save()} disabled={!changed || saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{t("notifications.actions.save")}</Button>
      </div>
    </div>
  );
}
