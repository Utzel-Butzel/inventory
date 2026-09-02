import { Database, FileImage, ScanLine } from "lucide-react";

import { Card } from "@/components/ui";
import { getOrganizationStorageUsage } from "@/lib/organization-storage-usage";
import { getT } from "@/lib/ui-i18n/server";

const byteUnits = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

function formatBytes(bytes: number, locale: string) {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${byteUnits[0]}`;
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    byteUnits.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value)} ${byteUnits[unitIndex]}`;
}

export async function OrganizationStorageUsage({
  organizationId,
}: {
  organizationId: string;
}) {
  const [{ t, lng }, usage] = await Promise.all([
    getT("settings"),
    getOrganizationStorageUsage(organizationId),
  ]);
  const roomScans = {
    bytes: usage.roomScanAssets.bytes + usage.roomScanKeyframes.bytes,
    fileCount:
      usage.roomScanAssets.fileCount + usage.roomScanKeyframes.fileCount,
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start gap-3 border-b border-border px-5 py-5 sm:px-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-solid text-on-brand">
          <Database className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">
            {t("storageUsage.title")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            {t("storageUsage.description")}
          </p>
        </div>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
        <StorageSummary
          icon={<Database className="size-4" aria-hidden="true" />}
          label={t("storageUsage.summary.total")}
          value={formatBytes(usage.total.bytes, lng)}
          hint={t("storageUsage.files", { count: usage.total.fileCount })}
        />
        <StorageSummary
          icon={<FileImage className="size-4" aria-hidden="true" />}
          label={t("storageUsage.summary.inventoryMedia")}
          value={formatBytes(usage.inventoryMedia.bytes, lng)}
          hint={t("storageUsage.files", {
            count: usage.inventoryMedia.fileCount,
          })}
        />
        <StorageSummary
          icon={<ScanLine className="size-4" aria-hidden="true" />}
          label={t("storageUsage.summary.roomScans")}
          value={formatBytes(roomScans.bytes, lng)}
          hint={t("storageUsage.files", { count: roomScans.fileCount })}
        />
      </div>
    </Card>
  );
}

function StorageSummary({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-subtle p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
