"use client";

import { Boxes, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "next-i18next/client";

import { useOrganizationHref } from "@/components/organization-routing";
import { fetchJson } from "@/lib/client-types";

type OptionSelection = {
  groupId: string;
  groupName: string;
  valueId: string;
  valueLabel: string;
};

type OptionConfiguration = {
  resourceId: string;
  resourceName: string;
  resourceSku: string | null;
  isPrimary: boolean;
  signature: string;
  selection: OptionSelection[];
};

type ResourceOptionsResponse = {
  currentResourceId: string;
  configurations: OptionConfiguration[];
};

type ResourceFamilyMember = {
  id: string;
  name: string;
  sku: string | null;
};

type ResourceFamilyResponse = {
  currentResourceId: string;
  primary: ResourceFamilyMember;
  variants: ResourceFamilyMember[];
};

const selectionLabel = (configuration: OptionConfiguration) =>
  configuration.selection.length
    ? configuration.selection
        .map(
          (selection) =>
            `${selection.groupName}: ${selection.valueLabel}`,
        )
        .join(" · ")
    : configuration.resourceName;

export function ResourceStockConfigurationSwitcher({
  resourceId,
  placement = "page",
}: {
  resourceId: string;
  placement?: "page" | "movement";
}) {
  const { t } = useT("stock");
  const router = useRouter();
  const organizationHref = useOrganizationHref();
  const [options, setOptions] = useState<ResourceOptionsResponse | null>(null);
  const [family, setFamily] = useState<ResourceFamilyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSwitching(false);
    setFailed(false);
    void Promise.all([
      fetchJson<ResourceOptionsResponse>(
        `/api/v1/resources/${resourceId}/options`,
        { cache: "no-store" },
      ).catch(() => null),
      fetchJson<ResourceFamilyResponse>(
        `/api/v1/resources/${resourceId}/family`,
        { cache: "no-store" },
      ).catch(() => null),
    ]).then(([optionsResponse, familyResponse]) => {
      if (!active) return;
      setOptions(optionsResponse);
      setFamily(familyResponse);
      setFailed(!optionsResponse && !familyResponse);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [resourceId]);

  const configuredByResourceId = new Map(
    (options?.configurations ?? []).map((configuration) => [
      configuration.resourceId,
      configuration,
    ]),
  );
  const familyMembers = family
    ? [family.primary, ...family.variants]
    : [];
  const configurations = familyMembers.length
    ? familyMembers.map((member) =>
        configuredByResourceId.get(member.id) ?? {
          resourceId: member.id,
          resourceName: member.name,
          resourceSku: member.sku,
          isPrimary: member.id === family?.primary.id,
          signature: member.id,
          selection: [],
        },
      )
    : (options?.configurations ?? []);
  const currentConfiguration =
    configurations.find(
      (configuration) => configuration.resourceId === resourceId,
    ) ?? null;

  if (loading) {
    return null;
  }

  if (failed) {
    if (placement === "movement") return null;

    return (
      <div className="mb-5 rounded-2xl border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning">
        {t("resource.configuration.error")}
      </div>
    );
  }

  if (configurations.length < 2) return null;

  const selectId =
    placement === "movement"
      ? "movement-stock-configuration"
      : "stock-configuration";
  const configurationSelect = (
    <div className="relative">
      <select
        id={selectId}
        value={
          options?.currentResourceId ??
          family?.currentResourceId ??
          resourceId
        }
        disabled={switching}
        onChange={(event) => {
          const nextResourceId = event.target.value;
          if (!nextResourceId || nextResourceId === resourceId) return;
          setSwitching(true);
          router.push(
            organizationHref(`/inventory/${nextResourceId}/stock`),
          );
        }}
        className="h-11 w-full rounded-xl border border-border bg-surface px-3 pr-10 text-sm font-medium text-foreground shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-wait disabled:opacity-70"
      >
        {configurations.map((configuration) => (
          <option
            key={configuration.resourceId}
            value={configuration.resourceId}
          >
            {selectionLabel(configuration)}
            {configuration.isPrimary
              ? ` ${t("resource.configuration.primary")}`
              : ""}
          </option>
        ))}
      </select>
      {switching ? (
        <LoaderCircle
          className="pointer-events-none absolute right-3 top-3.5 size-4 animate-spin text-muted"
          aria-hidden="true"
        />
      ) : null}
    </div>
  );

  if (placement === "movement") {
    return (
      <div className="mb-5 rounded-xl border border-brand-border bg-brand-soft/40 p-4">
        <label
          className="block text-[12px] font-semibold uppercase tracking-wider text-muted-strong"
          htmlFor={selectId}
        >
          {t("resource.configuration.label")}
        </label>
        <div className="mt-2">{configurationSelect}</div>
        <p className="mt-2 text-[12px] leading-4 text-muted">
          {t("resource.configuration.movementHelp")}
        </p>
      </div>
    );
  }

  return (
    <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-brand-border bg-brand-soft/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-brand shadow-sm">
          <Boxes className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {t("resource.configuration.title")}
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-muted">
            {t("resource.configuration.help")}
          </p>
          {currentConfiguration ? (
            <p className="mt-1 truncate text-xs font-medium text-muted-strong sm:max-w-xl">
              {selectionLabel(currentConfiguration)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="relative shrink-0 sm:w-80">
        <label className="sr-only" htmlFor={selectId}>
          {t("resource.configuration.label")}
        </label>
        {configurationSelect}
      </div>
    </section>
  );
}
