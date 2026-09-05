export function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function formatDateTime(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function statusTone(status: string) {
  if (["fulfilled", "returned", "delivered"].includes(status)) {
    return "success" as const;
  }
  if (status === "cancelled") return "danger" as const;
  if (["overdue", "partially-returned", "exception"].includes(status)) {
    return "warning" as const;
  }
  if (["confirmed", "reserved", "issued", "partially-issued", "partially-fulfilled", "ready", "shipped", "in_transit"].includes(status)) {
    return "brand" as const;
  }
  return "neutral" as const;
}

