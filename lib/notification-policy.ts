import type {
  NotificationChannel,
  NotificationEventType,
  NotificationFrequency,
  NotificationLocale,
  NotificationMetadata,
} from "@/lib/notification-contract";

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  enabledEventTypes: [
    "low_stock",
    "expiry",
    "maintenance",
    "return_due",
  ] as NotificationEventType[],
  frequency: "daily" as NotificationFrequency,
  digestHour: 8,
  timezone: "UTC",
  locale: "en" as NotificationLocale,
  cooldownHours: 24,
  lowStockThresholdPercent: 100,
  expiryWindowDays: 30,
  expiryFieldKey: "expiry_date",
  maintenanceWindowDays: 7,
  maintenanceFieldKey: "maintenance_due",
  returnDueWindowDays: 3,
  emailEnabled: false,
  pushEnabled: false,
  slackEnabled: false,
  teamsEnabled: false,
  webhookEnabled: false,
} as const;

export type DigestSchedule = {
  frequency: NotificationFrequency;
  digestHour: number;
  timezone: string;
  lastDigestAt: Date | null;
};

function localParts(date: Date, timezone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour ?? 0),
  };
}

export function digestIsDue(schedule: DigestSchedule, now: Date) {
  if (schedule.frequency === "immediate") return true;
  const current = localParts(now, schedule.timezone);
  if (current.hour < schedule.digestHour) return false;
  if (!schedule.lastDigestAt) return true;
  return (
    localParts(schedule.lastDigestAt, schedule.timezone).dateKey !==
    current.dateKey
  );
}

export function cooldownBucket(date: Date, cooldownHours: number) {
  const duration = Math.max(1, cooldownHours) * 60 * 60 * 1_000;
  return String(Math.floor(date.getTime() / duration));
}

export function parseNotificationDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fallsWithinWindow(
  value: unknown,
  now: Date,
  windowDays: number,
) {
  const date = parseNotificationDate(value);
  if (!date) return false;
  return date.getTime() <= now.getTime() + windowDays * 86_400_000;
}

export function redactTarget(value: string | undefined | null) {
  if (!value) return null;
  if (value.includes("@") && !value.includes("://")) {
    const [local = "", domain = ""] = value.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  try {
    const url = new URL(value);
    const tail = url.pathname.split("/").filter(Boolean).at(-1);
    return `${url.protocol}//${url.host}${tail ? `/…/${tail.slice(-6)}` : ""}`;
  } catch {
    return "configured";
  }
}

const copy: Record<
  NotificationLocale,
  Record<NotificationEventType, { title: string; body: (m: NotificationMetadata) => string }>
> = {
  en: {
    low_stock: {
      title: "Low stock",
      body: (metadata) =>
        `${metadata.name ?? "Item"} has ${metadata.quantity ?? 0} left (minimum ${metadata.minimumStock ?? 0}).`,
    },
    expiry: {
      title: "Expiry approaching",
      body: (metadata) =>
        `${metadata.name ?? "Item"} expires on ${metadata.dueAt ?? "the configured date"}.`,
    },
    maintenance: {
      title: "Maintenance attention",
      body: (metadata) =>
        metadata.dueAt
          ? `${metadata.name ?? "Item"} has maintenance due on ${metadata.dueAt}.`
          : `${metadata.name ?? "Item"} is marked for maintenance.`,
    },
    return_due: {
      title: "Return due",
      body: (metadata) =>
        `${metadata.name ?? "Item"} is due back on ${metadata.dueAt ?? "the configured date"}${metadata.assignee ? ` from ${metadata.assignee}` : ""}.`,
    },
  },
  de: {
    low_stock: {
      title: "Niedriger Bestand",
      body: (metadata) =>
        `${metadata.name ?? "Artikel"}: noch ${metadata.quantity ?? 0} verfügbar (Mindestbestand ${metadata.minimumStock ?? 0}).`,
    },
    expiry: {
      title: "Ablaufdatum naht",
      body: (metadata) =>
        `${metadata.name ?? "Artikel"} läuft am ${metadata.dueAt ?? "hinterlegten Datum"} ab.`,
    },
    maintenance: {
      title: "Wartung erforderlich",
      body: (metadata) =>
        metadata.dueAt
          ? `${metadata.name ?? "Artikel"}: Wartung fällig am ${metadata.dueAt}.`
          : `${metadata.name ?? "Artikel"} ist als Wartung markiert.`,
    },
    return_due: {
      title: "Rückgabe fällig",
      body: (metadata) =>
        `${metadata.name ?? "Artikel"} ist am ${metadata.dueAt ?? "hinterlegten Datum"}${metadata.assignee ? ` von ${metadata.assignee}` : ""} zurückzugeben.`,
    },
  },
};

export function notificationCopy(
  eventType: NotificationEventType,
  metadata: NotificationMetadata,
  locale: NotificationLocale,
) {
  const selected = copy[locale][eventType];
  return { title: selected.title, body: selected.body(metadata) };
}

export function channelPreview(
  channel: NotificationChannel,
  target: string | null,
  locale: NotificationLocale,
) {
  const sample = notificationCopy(
    "low_stock",
    { name: locale === "de" ? "Beispielartikel" : "Sample item", quantity: 2, minimumStock: 5 },
    locale,
  );
  return {
    dryRun: true as const,
    channel,
    target: redactTarget(target),
    subject:
      locale === "de"
        ? "Inventar-Benachrichtigungen · Vorschau"
        : "Inventory notifications · preview",
    events: [{ eventType: "low_stock" as const, ...sample }],
  };
}

export function boundedDigest<T>(items: readonly T[], maximum = 20) {
  const safeMaximum = Math.max(1, Math.floor(maximum));
  return {
    items: items.slice(0, safeMaximum),
    remainingCount: Math.max(0, items.length - safeMaximum),
  };
}
