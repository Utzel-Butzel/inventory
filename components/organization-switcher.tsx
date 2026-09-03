"use client";

import { Building2, ChevronsUpDown, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "next-i18next/client";

import { organizationPath } from "@/lib/organization-path";

export type ActiveOrganization = {
  id: string;
  name: string;
  slug: string;
  isReadOnly: boolean;
  allowNegativeStock: boolean;
};

export type OrganizationMembershipSummary = ActiveOrganization & {
  role: string;
  roleName: string;
};

function errorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

export function OrganizationSwitcher({
  organization,
  organizations,
}: {
  organization: ActiveOrganization;
  organizations: OrganizationMembershipSummary[];
}) {
  const { t } = useT("shell");
  const [selectedId, setSelectedId] = useState(organization.id);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(organization.id);
    setSwitching(false);
    setError(null);
  }, [organization.id]);

  async function selectOrganization(organizationId: string) {
    setSelectedId(organizationId);
    setError(null);
    if (organizationId === organization.id) return;

    setSwitching(true);
    try {
      const response = await fetch("/api/v1/organizations/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("organizations.errors.switch")));
      }

      // Organization selection changes the authorization boundary for every
      // client-side data source. A full navigation clears stale workspace state.
      const selectedOrganization = organizations.find(
        (candidate) => candidate.id === organizationId,
      );
      window.location.assign(
        organizationPath(
          selectedOrganization?.slug ?? organization.slug,
          "/inventory",
        ),
      );
    } catch (switchError) {
      setSelectedId(organization.id);
      setSwitching(false);
      setError(
        switchError instanceof Error
          ? switchError.message
          : t("organizations.errors.switch"),
      );
    }
  }

  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-[0.13em] text-sidebar-muted">
          {t("organizations.label")}
        </span>
        <span className="relative flex h-11 items-center rounded-xl border border-border bg-surface px-2.5 shadow-sm transition focus-within:border-focus focus-within:ring-3 focus-within:ring-focus/10">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
            <Building2 className="size-3.5" strokeWidth={2.1} aria-hidden="true" />
          </span>
          <span className="sr-only">{t("organizations.switcherLabel")}</span>
          <select
            value={selectedId}
            onChange={(event) => void selectOrganization(event.target.value)}
            disabled={switching}
            aria-label={t("organizations.switcherLabel")}
            className="h-full min-w-0 flex-1 appearance-none bg-transparent pl-2.5 pr-7 text-[14px] font-semibold text-foreground outline-none disabled:cursor-wait"
          >
            {organizations.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} · {option.roleName}
              </option>
            ))}
          </select>
          {switching ? (
            <LoaderCircle
              className="pointer-events-none absolute right-2.5 size-3.5 animate-spin text-muted"
              aria-hidden="true"
            />
          ) : (
            <ChevronsUpDown
              className="pointer-events-none absolute right-2.5 size-3.5 text-muted"
              aria-hidden="true"
            />
          )}
        </span>
      </label>
      {error ? (
        <p className="mt-1.5 px-1 text-[12px] leading-4 text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
