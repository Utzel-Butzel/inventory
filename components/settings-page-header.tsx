import type { ReactNode } from "react";

import { getT } from "@/lib/ui-i18n/server";

export async function SettingsPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { t } = await getT("settings");

  return (
    <header className="mb-7 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
          {t("header.eyebrow")}
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-[28px]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted sm:text-sm">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
